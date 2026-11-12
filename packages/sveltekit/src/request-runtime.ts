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
  type ActionFailure,
  type Actions,
  type RequestEvent,
  type RequestHandler,
  type ServerLoad,
} from "@sveltejs/kit";
import * as Cause from "effect/Cause";
import * as Console from "effect/Console";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import type { SvelteRouteId, SvelteRouteParams } from "./internal/route-params.js";
import { runPromiseExit } from "./internal/run.js";
import { SvelteKit, type ActionFailureOf, type KitErrorTranslator } from "./kit.js";

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
  runPromiseExit: (effect) => rt.runPromiseExit(effect),
  runFork: (effect) => rt.runFork(effect),
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
  Context.isContext(target) ? runnersFromContext(target) : runnersFromManagedRuntime(target);

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
    const runners = runnersFromManagedRuntime(rt);
    return { run: () => runners };
  },

  /**
   * Let the package build a single `ManagedRuntime` from a layer, lazily on
   * first use and shared across requests (the existing build-once-per-process
   * model).
   */
  fromLayer: <R, E>(layer: Layer.Layer<R, E>): RequestRuntimeProvider<R, E> => {
    // `ManagedRuntime.make` only allocates the runtime: the layer itself is
    // built by the first effect run on it, then shared.
    const runners = runnersFromManagedRuntime(ManagedRuntime.make(layer));
    return { run: () => runners };
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
      const teardown = (rt: ManagedRuntime.ManagedRuntime<R, E>): Promise<void> => {
        if (opts?.afterResponse) {
          opts.afterResponse(event, () => rt.dispose());
          return Promise.resolve();
        }
        return rt.dispose();
      };
      return {
        runPromiseExit: async (effect) => {
          const rt = ManagedRuntime.make(layer(event));
          // Tear the runtime down once the effect settles; a teardown failure
          // rejects in place of the exit.
          return rt.runPromiseExit(effect).finally(() => teardown(rt));
        },
        runFork: (effect) => {
          const rt = ManagedRuntime.make(layer(event));
          const fiber = rt.runFork(effect);
          fiber.addObserver(() => void teardown(rt));
          return fiber;
        },
      };
    },
  }),
};

/**
 * A boundary translator: turn a failed `Cause` into a thrown value. It never
 * returns (the throw-only `KitErrorTranslator`), so it cannot produce
 * `fail()`'s `ActionFailure`; a form action's translator can
 * (`KitActionErrorTranslator`).
 */
export type ErrorTranslator = (cause: Cause.Cause<unknown>) => never;

/**
 * Options shared by {@link makeRuntimeAdapter}. `Returned` is the
 * `ActionFailure` its `translateActionError` may return (none by default).
 */
export interface RuntimeAdapterOptions<Returned extends ActionFailure<unknown> = never> {
  /**
   * Translate a failed `Cause` into SvelteKit control flow at the boundary.
   * Called for `serverLoad` / `endpoint` failures, and for `action` /
   * `actions` failures unless `translateActionError` is given; it may throw
   * `redirect()` / `error()` (and, for remote forms, call `invalid()`), and
   * never returns. Defaults to the package's passthrough: SvelteKit's own
   * `redirect()` / `error()` are rethrown, anything else becomes an
   * `EffectCauseError` (a 500).
   */
  readonly translateError?: ErrorTranslator;
  /**
   * Translate a failed `Cause` at the boundary of `action` / `actions`, in
   * place of `translateError`. Unlike it, this translator may return
   * `fail(status, data)`: the action returns that `ActionFailure` to
   * SvelteKit, and its type is part of the action's result (so the route's
   * `ActionData` includes `data`). A throw-only translator fits here too.
   * Defaults to `translateError`.
   */
  readonly translateActionError?: KitErrorTranslator<Returned>;
}

/** Options for the adapter's `endpoint` wrapper. */
export interface AdapterEndpointOptions {
  /**
   * Include full error details (`Cause.pretty`) in the default 500 JSON body.
   * Ignored when a `translateError` is configured. Defaults to `false`.
   */
  readonly exposeErrors?: boolean;
}

/**
 * The wrappers produced by {@link makeRuntimeAdapter}, bound to a provider.
 * `Returned` is the `ActionFailure` the adapter's `translateActionError` may
 * return, which `action` / `actions` carry in their result.
 */
export interface RuntimeAdapter<R, Returned extends ActionFailure<unknown> = never> {
  readonly serverLoad: <
    Params extends SvelteRouteParams = SvelteRouteParams,
    ParentData extends Record<string, any> = any,
    OutputData extends Record<string, any> | void = any,
    RouteId extends SvelteRouteId = any,
  >(
    fn: (event: RequestEvent<Params, RouteId>) => Effect.Effect<OutputData, unknown, R>,
  ) => ServerLoad<Params, ParentData, OutputData, RouteId>;
  /**
   * Wraps an Effect-based function as a SvelteKit form action. A
   * `SvelteKit.fail(status, data)` failure in the Effect's error type `E`, or
   * a `fail()` the adapter's `translateActionError` returns, is the action's
   * result (an `ActionFailure`); any other failure goes to the translator,
   * which throws.
   */
  readonly action: <
    Params extends SvelteRouteParams = SvelteRouteParams,
    OutputData extends Record<string, any> | void = any,
    RouteId extends SvelteRouteId = any,
    E = unknown,
  >(
    fn: (event: RequestEvent<Params, RouteId>) => Effect.Effect<OutputData, E, R>,
  ) => Action<Params, OutputData | ActionFailureOf<E> | Returned, RouteId>;
  /**
   * Wraps an object of Effect-based form actions, each as `action` does.
   */
  readonly actions: <
    Params extends SvelteRouteParams = SvelteRouteParams,
    OutputData extends Record<string, any> | void = any,
    RouteId extends SvelteRouteId = any,
    E = unknown,
  >(
    map: Record<string, (event: RequestEvent<Params, RouteId>) => Effect.Effect<OutputData, E, R>>,
  ) => Actions<Params, OutputData | ActionFailureOf<E> | Returned, RouteId>;
  readonly endpoint: <
    Params extends SvelteRouteParams = SvelteRouteParams,
    RouteId extends SvelteRouteId = any,
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
export const makeRuntimeAdapter = <R, Returned extends ActionFailure<unknown> = never>(
  provider: RequestRuntimeProvider<R, any>,
  opts?: RuntimeAdapterOptions<Returned>,
): RuntimeAdapter<R, Returned> => {
  const translateError: ErrorTranslator = opts?.translateError ?? SvelteKit.translate;
  const translateActionError: KitErrorTranslator<Returned> =
    opts?.translateActionError ?? translateError;

  /**
   * Settle an endpoint's `Exit`: its `Response`, or the translator's verdict
   * on the failure (default: `SvelteKit.translate`). SvelteKit control-flow
   * objects (redirect, error, KitRedirect, KitError) fail the Effect with the
   * thrown value, for the wrapper to rethrow so SvelteKit can handle them.
   * Anything unrecognised is logged through Effect's default `Console` (the
   * global console) and becomes a 500 `Response`.
   */
  const settleEndpoint = (
    exit: Exit.Exit<Response, unknown>,
    options?: AdapterEndpointOptions,
  ): Effect.Effect<Response, unknown> =>
    Exit.match(exit, {
      onSuccess: (response) => Effect.succeed(response),
      onFailure: (cause) =>
        Effect.try({
          try: () => translateError(cause),
          catch: (thrown) => thrown,
        }).pipe(
          Effect.catch((thrown) =>
            isRedirect(thrown) || isHttpError(thrown)
              ? Effect.fail(thrown)
              : Effect.as(
                  Console.error("Endpoint error:", Cause.pretty(cause)),
                  // `Response.json` serialises the body and sets `Content-Type: application/json`.
                  Response.json(
                    {
                      error: options?.exposeErrors ? Cause.pretty(cause) : "Internal server error",
                    },
                    { status: 500 },
                  ),
                ),
          ),
        ),
    });

  const runSettle = async <A, Failure>(
    event: RequestEvent,
    effect: Effect.Effect<A, unknown, R>,
    translate: KitErrorTranslator<Failure>,
  ): Promise<A | Failure> => {
    const exit = await provider.run(event).runPromiseExit(effect);
    // Settle (the translator throws for a failure, or for an action may
    // return its `ActionFailure`), then dispose, then surface the settled
    // value or rethrow what the translator threw.
    const settled = Result.try(() => (Exit.isSuccess(exit) ? exit.value : translate(exit.cause)));
    provider.disposeAfterResponse?.(event);
    return Result.getOrElse(settled, (thrown) => {
      throw thrown;
    });
  };

  const action: RuntimeAdapter<R, Returned>["action"] = (fn) => (event) =>
    runSettle(
      event,
      fn(event).pipe(
        Effect.withSpan(`action ${event.route.id ?? "(unknown)"}`, { kind: "server" }),
        SvelteKit.failuresReturned,
      ),
      translateActionError,
    );

  return {
    serverLoad: (fn) => (event) =>
      runSettle(
        event,
        fn(event).pipe(
          Effect.withSpan(`serverLoad ${event.route.id ?? "(unknown)"}`, { kind: "server" }),
        ),
        translateError,
      ),
    action,
    actions: (map) => {
      return R.map(map, (fn) => action(fn));
    },
    endpoint: (fn, options) => async (event) => {
      const effect = fn(event).pipe(
        Effect.withSpan(`${event.request.method} ${event.route.id ?? "(unknown)"}`, {
          kind: "server",
        }),
      );
      const exit = await provider.run(event).runPromiseExit(effect);
      // The exit's cause may come from the provider (a layer that failed to
      // build), not from `effect`, so the failure is settled after the run, as
      // a second Effect with no services (`settleEndpoint`).
      const settled = await runPromiseExit(settleEndpoint(exit, options));
      provider.disposeAfterResponse?.(event);
      return Exit.match(settled, {
        onFailure: (cause) => {
          throw Cause.squash(cause);
        },
        onSuccess: (response) => response,
      });
    },
  };
};
