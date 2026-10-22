/**
 * A general, Effect-idiomatic way to provide the per-request execution context
 * for SvelteKit server wrappers.
 *
 * Where {@link makeServerRuntime} bakes in "the package owns a runtime, built
 * once per process," this module factors out the single decision *how to obtain
 * the execution context for this request* behind one open abstraction — a
 * {@link RequestRuntimeProvider}. Existing models (a build-once
 * `ManagedRuntime`, a layer built once), a consumer-owned runtime resolved from
 * `event.locals`, and a package-built per-request runtime are all just
 * {@link RequestRuntime} constructors of the same provider, not separate code
 * paths.
 *
 * {@link makeRuntimeAdapter} binds the `serverLoad` / `action` / `actions` /
 * `endpoint` wrappers to a provider (and an optional boundary error
 * translator), so the handler effect's requirement channel `R` is the
 * *provider's* services — your own application catalogue — rather than the fixed
 * {@link SvelteKitServices}.
 *
 * @example
 * ```ts
 * // The consumer owns a per-request ManagedRuntime on event.locals.runtime
 * // (rebuilt mid-request); the package adopts it, resolved at call time.
 * import { makeRuntimeAdapter, RequestRuntime } from "@thomasfosterau/effect-sveltekit/server";
 *
 * const { serverLoad, action, actions, endpoint } = makeRuntimeAdapter(
 *   RequestRuntime.fromLocals((event) => event.locals.runtime),
 *   { translateError: toSvelteKit },
 * );
 *
 * export const load = serverLoad((event) =>
 *   Effect.gen(function* () {
 *     const db = yield* Database; // app service from locals.runtime
 *     return { items: yield* db.list() };
 *   }),
 * );
 * ```
 */

import {
  isHttpError,
  isRedirect,
  type Action,
  type Actions,
  type RequestEvent,
  type RequestHandler,
  type ServerLoad,
} from "@sveltejs/kit";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import type { SvelteRouteParams } from "./internal/route-params.js";
import { SvelteKit } from "./kit.js";

/**
 * The runners a {@link RequestRuntimeProvider} resolves for a single request:
 * a way to run an `Effect<A, unknown, R>` that requires the provider's services
 * `R`. The error channel is `unknown` because a boundary translator (see
 * {@link makeRuntimeAdapter}) decides how failures surface.
 */
export interface RequestRuntimeRunners<in R> {
  /** Run the request's effect, keeping its `Exit` (never rejects). */
  readonly runPromiseExit: <A>(
    effect: Effect.Effect<A, unknown, R>,
  ) => Promise<Exit.Exit<A, unknown>>;
  /** Fork the request's effect, returning the running fiber. */
  readonly runFork: <A>(effect: Effect.Effect<A, unknown, R>) => Fiber.Fiber<A, unknown>;
}

/**
 * How to execute a request's effects. Resolved per request, at call time, so a
 * runtime the consumer rebuilds mid-request is honoured automatically.
 *
 * Implementations own the scope/lifecycle of whatever they build. `R` is the
 * set of services the handler effect may require; `E` is the layer construction
 * error type (informational — failures surface through the translator).
 */
export interface RequestRuntimeProvider<R, E = never> {
  /** Resolve the runners for a request. Consulted per call, never cached. */
  readonly run: (event: RequestEvent) => RequestRuntimeRunners<R>;
  /**
   * Optional teardown to run after the response is produced. Called by
   * {@link makeRuntimeAdapter} once the handler has settled — e.g. to route a
   * per-request resource's disposal through `ctx.waitUntil` on Workers.
   */
  readonly disposeAfterResponse?: (event: RequestEvent) => void;
  /** Phantom marker so `E` participates in inference. */
  readonly _E?: (_: never) => E;
}

/** Runners backed by an existing `ManagedRuntime`. */
const runnersFromManagedRuntime = <R>(
  rt: ManagedRuntime.ManagedRuntime<R, unknown>,
): RequestRuntimeRunners<R> => ({
  runPromiseExit: (effect) => rt.runPromiseExit(effect) as Promise<Exit.Exit<never, unknown>>,
  runFork: (effect) => rt.runFork(effect) as Fiber.Fiber<never, unknown>,
});

/** Runners backed by a built service `Context` (run on the default scheduler). */
const runnersFromContext = <R>(context: Context.Context<R>): RequestRuntimeRunners<R> => ({
  runPromiseExit: (effect) => Effect.runPromiseExitWith(context)(effect),
  runFork: (effect) => Effect.runForkWith(context)(effect),
});

/** Runners for a target that is either a `ManagedRuntime` or a `Context`. */
const runnersFor = <R>(
  target: ManagedRuntime.ManagedRuntime<R, unknown> | Context.Context<R>,
): RequestRuntimeRunners<R> =>
  ManagedRuntime.isManagedRuntime(target)
    ? runnersFromManagedRuntime(target as ManagedRuntime.ManagedRuntime<R, unknown>)
    : runnersFromContext(target as Context.Context<R>);

/** Options for {@link RequestRuntime.fromLayerPerRequest}. */
export interface FromLayerPerRequestOptions {
  /**
   * Defer teardown of the per-request runtime to after the response is
   * produced, instead of awaiting `dispose()` inline. On Workers, route it
   * through `ctx.waitUntil` so disposal does not fight response streaming or
   * socket pinning:
   *
   * ```ts
   * { afterResponse: (event, dispose) => event.platform!.ctx.waitUntil(dispose()) }
   * ```
   */
  readonly afterResponse?: (event: RequestEvent, dispose: () => Promise<void>) => void;
}

/**
 * Constructors for {@link RequestRuntimeProvider}. Each expresses one way to
 * obtain a request's execution context; the wrappers don't care which.
 */
export const RequestRuntime = {
  /**
   * Adopt a `ManagedRuntime` the consumer already built (the build-once model,
   * expressed as a provider).
   */
  fromManagedRuntime: <R, E>(
    rt: ManagedRuntime.ManagedRuntime<R, E>,
  ): RequestRuntimeProvider<R, E> => {
    const runners = runnersFromManagedRuntime(rt as ManagedRuntime.ManagedRuntime<R, unknown>);
    return { run: () => runners };
  },

  /**
   * Let the package build a single `ManagedRuntime` from a layer, lazily on
   * first use and shared across requests (the existing build-once-per-process
   * model).
   */
  fromLayer: <R, E>(layer: Layer.Layer<R, E>): RequestRuntimeProvider<R, E> => {
    let runners: RequestRuntimeRunners<R> | undefined;
    return {
      run: () =>
        (runners ??= runnersFromManagedRuntime(
          ManagedRuntime.make(layer) as ManagedRuntime.ManagedRuntime<R, unknown>,
        )),
    };
  },

  /**
   * Adopt a runtime the consumer stashed on the request (e.g. on
   * `event.locals`). Resolved at call time, so a runtime rebuilt mid-request is
   * honoured automatically. The getter may return a `ManagedRuntime` or a
   * built service `Context`.
   */
  fromLocals: <R>(
    get: (event: RequestEvent) => ManagedRuntime.ManagedRuntime<R, unknown> | Context.Context<R>,
  ): RequestRuntimeProvider<R> => ({
    run: (event) => runnersFor(get(event)),
  }),

  /**
   * Let the package build *and dispose* a `ManagedRuntime` per request from a
   * layer factory. Each handler invocation builds its own runtime from
   * `layer(event)` and disposes it once the effect settles — so a per-request
   * resource (a DB pool) dies with the request. Use `opts.afterResponse` to
   * defer disposal to after the response (Workers `ctx.waitUntil`).
   *
   * For sharing one runtime across every load/action of a request, prefer
   * {@link RequestRuntime.fromLocals} with a runtime the consumer builds in
   * `hooks.server.ts`.
   */
  fromLayerPerRequest: <R, E>(
    layer: (event: RequestEvent) => Layer.Layer<R, E>,
    opts?: FromLayerPerRequestOptions,
  ): RequestRuntimeProvider<R, E> => ({
    run: (event) => {
      const dispose = (rt: ManagedRuntime.ManagedRuntime<R, E>) => () => rt.dispose();
      const teardown = (rt: ManagedRuntime.ManagedRuntime<R, E>): Promise<void> => {
        if (opts?.afterResponse) {
          opts.afterResponse(event, dispose(rt));
          return Promise.resolve();
        }
        return rt.dispose();
      };
      return {
        runPromiseExit: async (effect) => {
          const rt = ManagedRuntime.make(layer(event));
          try {
            return (await rt.runPromiseExit(effect)) as Exit.Exit<never, unknown>;
          } finally {
            await teardown(rt);
          }
        },
        runFork: (effect) => {
          const rt = ManagedRuntime.make(layer(event));
          const fiber = rt.runFork(effect) as Fiber.Fiber<never, unknown>;
          fiber.addObserver(() => void teardown(rt));
          return fiber;
        },
      };
    },
  }),
};

/** A boundary translator: turn a failed `Cause` into a thrown value. */
export type ErrorTranslator = (cause: Cause.Cause<unknown>) => never;

/** Options shared by {@link makeRuntimeAdapter}. */
export interface RuntimeAdapterOptions {
  /**
   * Translate a failed `Cause` into SvelteKit control flow at the boundary.
   * Called for `serverLoad` / `action` / `actions` failures; it may throw
   * `redirect()` / `error()` (and, for remote forms, call `invalid()`).
   * Defaults to the package's passthrough: SvelteKit's own `redirect()` /
   * `error()` are rethrown, anything else becomes an `EffectCauseError` (a 500).
   */
  readonly translateError?: ErrorTranslator;
}

/** Options for the adapter's `endpoint` wrapper. */
export interface AdapterEndpointOptions {
  /**
   * Include full error details (`Cause.pretty`) in the default 500 JSON body.
   * Ignored when a `translateError` is configured. Defaults to `false`.
   */
  readonly exposeErrors?: boolean;
}

/** The wrappers produced by {@link makeRuntimeAdapter}, bound to a provider. */
export interface RuntimeAdapter<R> {
  readonly serverLoad: <
    Params extends SvelteRouteParams = SvelteRouteParams,
    ParentData extends Record<string, any> = any,
    OutputData extends Record<string, any> | void = any,
    RouteId extends string | null = any,
  >(
    fn: (event: RequestEvent<Params, RouteId>) => Effect.Effect<OutputData, unknown, R>,
  ) => ServerLoad<Params, ParentData, OutputData, RouteId>;
  readonly action: <
    Params extends SvelteRouteParams = SvelteRouteParams,
    OutputData extends Record<string, any> | void = any,
    RouteId extends string | null = any,
  >(
    fn: (event: RequestEvent<Params, RouteId>) => Effect.Effect<OutputData, unknown, R>,
  ) => Action<Params, OutputData, RouteId>;
  readonly actions: <
    Params extends SvelteRouteParams = SvelteRouteParams,
    OutputData extends Record<string, any> | void = any,
    RouteId extends string | null = any,
  >(
    map: Record<
      string,
      (event: RequestEvent<Params, RouteId>) => Effect.Effect<OutputData, unknown, R>
    >,
  ) => Actions<Params, OutputData, RouteId>;
  readonly endpoint: <
    Params extends SvelteRouteParams = SvelteRouteParams,
    RouteId extends string | null = any,
  >(
    fn: (event: RequestEvent<Params, RouteId>) => Effect.Effect<Response, unknown, R>,
    options?: AdapterEndpointOptions,
  ) => RequestHandler<Params, RouteId>;
}

/**
 * Bind the SvelteKit server wrappers to a {@link RequestRuntimeProvider} (and an
 * optional boundary error translator).
 *
 * Unlike the standalone `serverLoad` / `action` / `endpoint`, the handler
 * effect's required services `R` come from the provider — your own application
 * catalogue — not the fixed {@link SvelteKitServices}. The package does not
 * merge `HttpClient` / `SvelteKitRequestEvent` onto this path; add them to your
 * own layer if you want them.
 *
 * @example
 * ```ts
 * // Package owns the runtime per request on Workers, disposed via waitUntil.
 * const { serverLoad } = makeRuntimeAdapter(
 *   RequestRuntime.fromLayerPerRequest((event) => AppLayer(event.platform!.env), {
 *     afterResponse: (event, dispose) => event.platform!.ctx.waitUntil(dispose()),
 *   }),
 * );
 * ```
 */
export const makeRuntimeAdapter = <R>(
  provider: RequestRuntimeProvider<R, any>,
  opts?: RuntimeAdapterOptions,
): RuntimeAdapter<R> => {
  const translateError: ErrorTranslator = opts?.translateError ?? SvelteKit.translate;

  const runSettle = async <A>(
    event: RequestEvent,
    effect: Effect.Effect<A, unknown, R>,
  ): Promise<A> => {
    const exit = await provider.run(event).runPromiseExit(effect);
    try {
      if (Exit.isSuccess(exit)) return exit.value;
      return translateError(exit.cause);
    } finally {
      provider.disposeAfterResponse?.(event);
    }
  };

  const action: RuntimeAdapter<R>["action"] = (fn) => (event) =>
    runSettle(
      event,
      fn(event).pipe(
        Effect.withSpan(`action ${event.route.id ?? "(unknown)"}`, { kind: "server" }),
      ),
    );

  return {
    serverLoad: (fn) => (event) =>
      runSettle(
        event,
        fn(event).pipe(
          Effect.withSpan(`serverLoad ${event.route.id ?? "(unknown)"}`, { kind: "server" }),
        ),
      ),
    action,
    actions: (map) => {
      const wrapped: Record<string, Action<any, any, any>> = {};
      for (const [key, fn] of Object.entries(map)) wrapped[key] = action(fn);
      return wrapped as never;
    },
    endpoint: (fn, options) => async (event) => {
      const effect = fn(event).pipe(
        Effect.withSpan(
          `${(event as RequestEvent).request.method} ${(event as RequestEvent).route.id ?? "(unknown)"}`,
          { kind: "server" },
        ),
      );
      const exit = await provider.run(event as RequestEvent).runPromiseExit(effect);
      try {
        if (Exit.isSuccess(exit)) return exit.value;
        // Run the translator (default: SvelteKit.translate). SvelteKit
        // control-flow objects (redirect, error, KitRedirect, KitError) are
        // thrown so SvelteKit can handle them. Anything unrecognised is wrapped
        // in an EffectCauseError and caught below to produce a 500 Response.
        try {
          return translateError(exit.cause);
        } catch (err) {
          if (isRedirect(err) || isHttpError(err)) throw err;
          console.error("Endpoint error:", Cause.pretty(exit.cause));
          const message = options?.exposeErrors
            ? Cause.pretty(exit.cause)
            : "Internal server error";
          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      } finally {
        provider.disposeAfterResponse?.(event as RequestEvent);
      }
    },
  };
};
