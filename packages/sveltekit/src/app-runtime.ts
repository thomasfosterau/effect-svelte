/**
 * App-wide Effect runtimes for SvelteKit.
 *
 * `makeServerRuntime` / `makeUniversalRuntime` let an application define its
 * Effect services (database clients, API wrappers, config, ...) as a single
 * `Layer`, built once per server process and shared by every request, instead
 * of being rebuilt for each `load` / `action` / endpoint invocation.
 *
 * Per-request services — the {@link SvelteKitRequestEvent} and an `HttpClient`
 * backed by the event's `fetch` — are provided on top of the shared runtime
 * for each call, so SvelteKit's fetch behaviours (cookie forwarding, request
 * deduplication, relative URLs) keep working as expected.
 */

import type {
  Action,
  Actions,
  Handle,
  HandleFetch,
  HandleServerError,
  Load,
  RequestEvent,
  ServerInit,
  ServerLoad,
} from "@sveltejs/kit";
import { Context, Effect, type Fiber, Exit, Layer, ManagedRuntime, Scope } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import { SvelteKitRequestEvent } from "./runtime.js";
import type { SvelteRouteParams } from "./internal/route-params.js";
import type { ErrorTranslator } from "./request-runtime.js";
import { SvelteKit } from "./kit.js";
import {
  SvelteKitCookies,
  SvelteKitLocals,
  SvelteKitResponseHeaders,
  requestServicesFrom,
} from "./request-services.js";

/**
 * The services provided to every wrapped effect on the server, in addition to
 * the application's own layer.
 */
export type SvelteKitServices =
  | HttpClient.HttpClient
  | SvelteKitRequestEvent
  | SvelteKitCookies
  | SvelteKitResponseHeaders
  | SvelteKitLocals;

/**
 * A per-request Effect runtime: the application layer's services plus the
 * per-request {@link SvelteKitServices} (an `HttpClient` backed by the request's
 * `fetch`, and the {@link SvelteKitRequestEvent}), with the request services
 * built once for the request and shared.
 *
 * A {@link ServerRuntime}'s `handle` hook creates one per request and stores it
 * on `event.locals` (`App.Locals`). Every other wrapper for the same runtime
 * (`serverLoad`, `action`, `endpoint`, ...) then runs on it, so a request's
 * effects share one `HttpClient` and one request scope. Retrieve it from an
 * event with `ServerRuntime.requestRuntime` to run your own effects.
 */
export interface RequestRuntime<R = never> {
  /** Run an effect for this request, returning its `Exit`. */
  readonly runPromiseExit: <A>(
    effect: Effect.Effect<A, unknown, R | SvelteKitServices>,
  ) => Promise<Exit.Exit<A, unknown>>;
  /** Run an effect for this request, throwing on failure (passing SvelteKit control flow through). */
  readonly runPromise: <A>(effect: Effect.Effect<A, unknown, R | SvelteKitServices>) => Promise<A>;
  /** Fork an effect for this request, returning the running fiber. */
  readonly runFork: <A>(
    effect: Effect.Effect<A, unknown, R | SvelteKitServices>,
  ) => Fiber.Fiber<A, unknown>;
}

/**
 * Symbol under which a {@link ServerRuntime}'s `handle` stores the per-request
 * {@link RequestRuntime} on `event.locals`. `Symbol.for` so the key is stable
 * across module instances.
 */
const RequestRuntimeKey: unique symbol = Symbol.for(
  "@thomasfosterau/effect-sveltekit/requestRuntime",
);

/**
 * The locals entry: the per-request runtime tagged with the `ServerRuntime`
 * that created it, so a different runtime's wrappers ignore it (and fall back
 * to building request services themselves) rather than running on the wrong
 * application layer.
 */
interface RequestRuntimeEntry {
  readonly owner: object;
  readonly runtime: RequestRuntime<any>;
}

/** Read the per-request runtime entry an event carries, if any. */
const requestRuntimeEntry = (event: RequestEvent): RequestRuntimeEntry | undefined =>
  (event.locals as Record<PropertyKey, unknown> | undefined)?.[RequestRuntimeKey] as
    | RequestRuntimeEntry
    | undefined;

/** Layer with the per-request services for a server-side request. */
const requestLayer = (event: RequestEvent): Layer.Layer<SvelteKitServices> => {
  const services = requestServicesFrom(event);
  return Layer.mergeAll(
    FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, event.fetch))),
    Layer.succeed(SvelteKitRequestEvent, event),
    Layer.succeed(SvelteKitCookies, services.cookies),
    Layer.succeed(SvelteKitResponseHeaders, services.responseHeaders),
    Layer.succeed(SvelteKitLocals, services.locals),
  );
};

/** Layer providing `HttpClient` backed by an arbitrary fetch implementation. */
const fetchLayer = (fetchFn: typeof globalThis.fetch): Layer.Layer<HttpClient.HttpClient> =>
  FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchFn)));

/** Build a settle that returns a success value or throws via the translator. */
const makeSettle =
  (translate: ErrorTranslator) =>
  <A>(exit: Exit.Exit<A, unknown>): A =>
    Exit.match(exit, {
      onFailure: (cause) => translate(cause),
      onSuccess: (value) => value,
    });

/** The default settle: Kit control-flow errors through, anything else a 500. */
const settle = makeSettle(SvelteKit.translate);

/**
 * Options for {@link makeServerRuntime}.
 */
export interface ServerRuntimeOptions {
  /**
   * Translate a failed `Cause` into SvelteKit control flow at the boundary of
   * every wrapper (`serverLoad`, `action`, `actions`, `endpoint`, `handle`,
   * `handleFetch`, `handleError`, `init`). It may throw `redirect()` /
   * `error()` so a domain error catalogue surfaces as SvelteKit control flow
   * instead of a generic 500. Defaults to the package passthrough: SvelteKit's
   * own `redirect()` / `error()` are rethrown, anything else becomes an
   * `EffectCauseError` (a 500).
   */
  readonly translateError?: ErrorTranslator;
}

/**
 * A server-side Effect runtime bound to an application layer.
 *
 * Produced by {@link makeServerRuntime}. The wrapper methods mirror the
 * standalone helpers in `@thomasfosterau/effect-sveltekit/server`, but
 * effects additionally have access to the services `R` of the application
 * layer.
 */
export interface ServerRuntime<R = never, E = never> {
  /** The underlying managed runtime for the application layer. */
  readonly runtime: ManagedRuntime.ManagedRuntime<R, E>;

  /**
   * Wraps an Effect-based function as a SvelteKit server `load`.
   */
  readonly serverLoad: <
    Params extends SvelteRouteParams = SvelteRouteParams,
    ParentData extends Record<string, any> = any,
    OutputData extends Record<string, any> | void = any,
    RouteId extends string | null = any,
  >(
    fn: (
      event: RequestEvent<Params, RouteId>,
    ) => Effect.Effect<OutputData, unknown, R | SvelteKitServices>,
  ) => ServerLoad<Params, ParentData, OutputData, RouteId>;

  /**
   * Wraps an Effect-based function as a SvelteKit form action.
   */
  readonly action: <
    Params extends SvelteRouteParams = SvelteRouteParams,
    OutputData extends Record<string, any> | void = any,
    RouteId extends string | null = any,
  >(
    fn: (
      event: RequestEvent<Params, RouteId>,
    ) => Effect.Effect<OutputData, unknown, R | SvelteKitServices>,
  ) => Action<Params, OutputData, RouteId>;

  /**
   * Wraps an object of Effect-based form actions.
   */
  readonly actions: <
    Params extends SvelteRouteParams = SvelteRouteParams,
    OutputData extends Record<string, any> | void = any,
    RouteId extends string | null = any,
  >(
    actionsMap: Record<
      string,
      (
        event: RequestEvent<Params, RouteId>,
      ) => Effect.Effect<OutputData, unknown, R | SvelteKitServices>
    >,
  ) => Actions<Params, OutputData, RouteId>;

  /**
   * Wraps an Effect-based function as a SvelteKit `handle` hook.
   */
  readonly handle: (
    fn: (args: Parameters<Handle>[0]) => Effect.Effect<Response, unknown, R | SvelteKitServices>,
  ) => Handle;

  /**
   * Wraps an Effect-based function as a SvelteKit server `handleFetch` hook,
   * which intercepts `event.fetch` calls made on the server. The effect runs
   * with the per-request services on top of the application layer and produces
   * the `Response` to use.
   */
  readonly handleFetch: (
    fn: (
      args: Parameters<HandleFetch>[0],
    ) => Effect.Effect<Response, unknown, R | SvelteKitServices>,
  ) => HandleFetch;

  /**
   * Wraps an Effect-based function as a SvelteKit server `handleError` hook.
   *
   * The effect receives the error and the request event, and produces the
   * shape that SvelteKit exposes to the client (your `App.Error`, or nothing).
   * It runs with the per-request services on top of the application layer.
   */
  readonly handleError: (
    fn: (
      args: Parameters<HandleServerError>[0],
    ) => Effect.Effect<Awaited<ReturnType<HandleServerError>>, unknown, R | SvelteKitServices>,
  ) => HandleServerError;

  /**
   * Wraps an Effect as a SvelteKit server `init` hook, run once before the
   * server responds to its first request. There is no request event, so the
   * effect only has access to the application layer's services.
   */
  readonly init: (effect: Effect.Effect<void, unknown, R>) => ServerInit;

  /**
   * The per-request {@link RequestRuntime} this runtime's `handle` stored on the
   * event, or `undefined` when `handle` was not used for the request. Use it to
   * run your own effects on the same per-request runtime (shared `HttpClient`
   * and request scope) that `serverLoad` / `action` / `endpoint` use.
   *
   * @example
   * ```ts
   * // anywhere with the request event, e.g. another `handle` in the sequence
   * const rt = runtime.requestRuntime(event);
   * await rt?.runPromise(Effect.gen(function* () {
   *   const user = yield* Auth.currentUser;
   *   event.locals.user = user;
   * }));
   * ```
   */
  readonly requestRuntime: (event: RequestEvent) => RequestRuntime<R> | undefined;

  /**
   * Wraps an Effect-based function as a SvelteKit `+server.ts` endpoint
   * handler (`GET`, `POST`, ...).
   */
  readonly endpoint: <
    Params extends SvelteRouteParams = SvelteRouteParams,
    RouteId extends string | null = any,
  >(
    fn: (
      event: RequestEvent<Params, RouteId>,
    ) => Effect.Effect<Response, unknown, R | SvelteKitServices>,
  ) => (event: RequestEvent<Params, RouteId>) => Promise<Response>;

  /**
   * Runs an effect for a specific request, providing both the application
   * layer and the per-request services. Failures (other than SvelteKit
   * control flow) are thrown as `EffectCauseError`.
   */
  readonly runPromise: <A>(
    event: RequestEvent,
    effect: Effect.Effect<A, unknown, R | SvelteKitServices>,
  ) => Promise<A>;

  /**
   * Runs an effect for a specific request and returns the Exit, without
   * translating failures into thrown errors.
   */
  readonly runPromiseExit: <A>(
    event: RequestEvent,
    effect: Effect.Effect<A, unknown, R | SvelteKitServices>,
  ) => Promise<Exit.Exit<A, unknown>>;

  /**
   * Disposes the underlying managed runtime, running the layer's finalizers.
   * Call this on server shutdown or in tests.
   */
  readonly dispose: () => Promise<void>;
}

/**
 * Creates a {@link ServerRuntime} from an application layer.
 *
 * The layer is built lazily on first use and shared by all requests for the
 * lifetime of the server process. Define it once in a server-only module and
 * import its wrappers from your routes:
 *
 * @example
 * ```ts
 * // src/lib/server/runtime.ts
 * import { makeServerRuntime } from '@thomasfosterau/effect-sveltekit/server';
 * import { Layer } from 'effect';
 * import { Database } from './database';
 *
 * export const runtime = makeServerRuntime(Database.layer);
 * ```
 *
 * ```ts
 * // src/routes/items/+page.server.ts
 * import { runtime } from '$lib/server/runtime';
 * import { Effect } from 'effect';
 * import { Database } from '$lib/server/database';
 *
 * export const load = runtime.serverLoad((event) =>
 *   Effect.gen(function* () {
 *     const db = yield* Database;
 *     return { items: yield* db.listItems() };
 *   })
 * );
 * ```
 *
 * Note that the application layer is built outside of any request, so its
 * services cannot depend on the per-request `SvelteKitRequestEvent` or
 * `HttpClient`. Request-specific data should be passed to service methods as
 * arguments instead.
 */
export const makeServerRuntime = <R = never, E = never>(
  layer?: Layer.Layer<R, E>,
  options?: ServerRuntimeOptions,
): ServerRuntime<R, E> => {
  const runtime = ManagedRuntime.make((layer ?? Layer.empty) as Layer.Layer<R, E>);

  // The boundary translator for this runtime's wrappers (defaults to the
  // package passthrough: SvelteKit control flow through, anything else a 500).
  const settleRequest = options?.translateError ? makeSettle(options.translateError) : settle;

  // Identity token tagging the per-request runtimes this runtime creates, so a
  // different runtime's wrappers don't run on the wrong application layer.
  const owner = {};

  /** A {@link ScopedRequestRuntime} that provides the prebuilt request services. */
  const makeRequestRuntime = (
    requestServices: Context.Context<SvelteKitServices>,
  ): RequestRuntime<R> => {
    const provide = <A>(effect: Effect.Effect<A, unknown, R | SvelteKitServices>) =>
      Effect.provideContext(effect, requestServices) as Effect.Effect<A, unknown, R>;
    return {
      runPromiseExit: (effect) =>
        runtime.runPromiseExit(provide(effect)) as Promise<Exit.Exit<any, unknown>>,
      runPromise: (effect) => runtime.runPromiseExit(provide(effect)).then(settleRequest),
      runFork: (effect) => runtime.runFork(provide(effect)) as Fiber.Fiber<any, unknown>,
    };
  };

  /** The per-request runtime for this runtime carried by the event, if any. */
  const requestRuntimeOf = (event: RequestEvent): RequestRuntime<R> | undefined => {
    const entry = requestRuntimeEntry(event);
    return entry?.owner === owner ? (entry.runtime as RequestRuntime<R>) : undefined;
  };

  const runExit = <A>(
    event: RequestEvent,
    effect: Effect.Effect<A, unknown, R | SvelteKitServices>,
  ): Promise<Exit.Exit<A, unknown>> => {
    // Reuse the per-request runtime `handle` installed, if any; otherwise build
    // the per-request services for this single call.
    const requestRuntime = requestRuntimeOf(event);
    if (requestRuntime !== undefined) return requestRuntime.runPromiseExit(effect);
    const provided = Effect.provide(effect, requestLayer(event)) as Effect.Effect<A, unknown, R>;
    return runtime.runPromiseExit(provided) as Promise<Exit.Exit<A, unknown>>;
  };

  const run = <A>(
    event: RequestEvent,
    effect: Effect.Effect<A, unknown, R | SvelteKitServices>,
  ): Promise<A> => runExit(event, effect).then(settleRequest);

  const action: ServerRuntime<R, E>["action"] = (fn) => (event) => run(event, fn(event));

  /**
   * The `handle` hook: build a per-request runtime, store it on `event.locals`
   * so every other wrapper (and the user's own code) runs on it, run the user's
   * effect, then close the request scope.
   */
  const handle: ServerRuntime<R, E>["handle"] = (fn) => async (input) => {
    const { event } = input;
    const scope = Scope.makeUnsafe();
    const requestServices = (await runtime.runPromise(
      Layer.buildWithScope(requestLayer(event), scope),
    )) as Context.Context<SvelteKitServices>;

    const entry: RequestRuntimeEntry = { owner, runtime: makeRequestRuntime(requestServices) };
    (event.locals as Record<PropertyKey, unknown>)[RequestRuntimeKey] = entry;

    try {
      return await (entry.runtime as RequestRuntime<R>).runPromise(fn(input));
    } finally {
      await runtime.runPromise(Scope.close(scope, Exit.void));
    }
  };

  return {
    runtime,
    serverLoad: (fn) => (event) => run(event, fn(event)),
    action,
    actions: (actionsMap) => {
      const wrapped: Record<string, Action<any, any, any>> = {};
      for (const [key, fn] of Object.entries(actionsMap)) {
        wrapped[key] = action(fn);
      }
      return wrapped as never;
    },
    handle,
    handleFetch: (fn) => (args) => run(args.event, fn(args)),
    handleError: (fn) => (args) => run(args.event, fn(args)),
    init: (effect) => async () => {
      // `init` runs outside of any request, so it executes directly on the
      // application runtime without the per-request layer.
      settleRequest(await runtime.runPromiseExit(effect));
    },
    requestRuntime: requestRuntimeOf,
    endpoint: (fn) => (event) => run(event, fn(event)),
    runPromise: run,
    runPromiseExit: runExit,
    dispose: () => runtime.dispose(),
  };
};

/**
 * A universal (client + server) Effect runtime bound to an application layer.
 *
 * Produced by {@link makeUniversalRuntime}. Because universal `load`
 * functions also run in the browser, the layer must only use services that
 * work in both environments.
 */
export interface UniversalRuntime<R = never, E = never> {
  /** The underlying managed runtime for the application layer. */
  readonly runtime: ManagedRuntime.ManagedRuntime<R, E>;

  /**
   * Wraps an Effect-based function as a SvelteKit universal `load`.
   *
   * The effect gets `HttpClient` (backed by the load event's `fetch`) on both
   * client and server, plus the services of the application layer.
   */
  readonly load: <
    Params extends SvelteRouteParams = SvelteRouteParams,
    InputData extends Record<string, unknown> | null = any,
    ParentData extends Record<string, unknown> = any,
    OutputData extends Record<string, unknown> | void = any,
    RouteId extends string | null = any,
  >(
    fn: (
      event: Parameters<Load<Params, InputData, ParentData, OutputData, RouteId>>[0],
    ) => Effect.Effect<OutputData, unknown, R | HttpClient.HttpClient>,
  ) => Load<Params, InputData, ParentData, OutputData, RouteId>;

  /**
   * Runs an effect with `HttpClient` backed by the given fetch implementation
   * plus the application layer.
   */
  readonly runPromise: <A>(
    fetchFn: typeof globalThis.fetch,
    effect: Effect.Effect<A, unknown, R | HttpClient.HttpClient>,
  ) => Promise<A>;

  /**
   * Disposes the underlying managed runtime, running the layer's finalizers.
   */
  readonly dispose: () => Promise<void>;
}

/**
 * Creates a {@link UniversalRuntime} from an application layer.
 *
 * @example
 * ```ts
 * // src/lib/runtime.ts
 * import { makeUniversalRuntime } from '@thomasfosterau/effect-sveltekit';
 * import { ApiClient } from '$lib/api';
 *
 * export const runtime = makeUniversalRuntime(ApiClient.layer);
 * ```
 *
 * ```ts
 * // src/routes/+page.ts
 * import { runtime } from '$lib/runtime';
 * import { Effect } from 'effect';
 * import { ApiClient } from '$lib/api';
 *
 * export const load = runtime.load((event) =>
 *   Effect.gen(function* () {
 *     const api = yield* ApiClient;
 *     return { stories: yield* api.topStories() };
 *   })
 * );
 * ```
 */
export const makeUniversalRuntime = <R = never, E = never>(
  layer?: Layer.Layer<R, E>,
): UniversalRuntime<R, E> => {
  const runtime = ManagedRuntime.make((layer ?? Layer.empty) as Layer.Layer<R, E>);

  const run = <A>(
    fetchFn: typeof globalThis.fetch,
    effect: Effect.Effect<A, unknown, R | HttpClient.HttpClient>,
    event?: RequestEvent,
  ): Promise<A> => {
    // On the server the full request layer (HttpClient + SvelteKitRequestEvent)
    // is available; on the client only HttpClient backed by the event's fetch.
    const services = event ? requestLayer(event) : fetchLayer(fetchFn);
    const provided = Effect.provide(effect, services) as Effect.Effect<A, unknown, R>;
    return runtime.runPromiseExit(provided).then(settle);
  };

  return {
    runtime,
    load: (fn) => (event) => {
      const serverEvent = (event as { request?: unknown }).request
        ? (event as unknown as RequestEvent)
        : undefined;
      return run(event.fetch, fn(event), serverEvent);
    },
    runPromise: (fetchFn, effect) => run(fetchFn, effect),
    dispose: () => runtime.dispose(),
  };
};
