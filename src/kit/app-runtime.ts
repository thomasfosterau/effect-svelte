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

import type { Action, Actions, Handle, Load, RequestEvent, ServerLoad } from "@sveltejs/kit";
import { Effect, Exit, Layer, ManagedRuntime } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import { SvelteKitRequestEvent } from "./runtime.js";
import { causeToThrowable } from "./internal/error.js";

/**
 * The services provided to every wrapped effect on the server, in addition to
 * the application's own layer.
 */
export type SvelteKitServices = HttpClient.HttpClient | SvelteKitRequestEvent;

/** Layer with the per-request services for a server-side request. */
const requestLayer = (event: RequestEvent): Layer.Layer<SvelteKitServices> =>
  Layer.merge(
    FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, event.fetch))),
    Layer.succeed(SvelteKitRequestEvent, event),
  );

/** Layer providing `HttpClient` backed by an arbitrary fetch implementation. */
const fetchLayer = (fetchFn: typeof globalThis.fetch): Layer.Layer<HttpClient.HttpClient> =>
  FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchFn)));

/** Settle an exit the way SvelteKit expects: return the value or throw. */
const settle = <A>(exit: Exit.Exit<A, unknown>): A =>
  Exit.match(exit, {
    onFailure: (cause) => {
      throw causeToThrowable(cause);
    },
    onSuccess: (value) => value,
  });

/**
 * A server-side Effect runtime bound to an application layer.
 *
 * Produced by {@link makeServerRuntime}. The wrapper methods mirror the
 * standalone helpers in `@thomasfosterau/effect-svelte/kit/server`, but
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
    Params extends Record<string, string> = any,
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
    Params extends Record<string, string> = any,
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
    Params extends Record<string, string> = any,
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
   * Wraps an Effect-based function as a SvelteKit `+server.ts` endpoint
   * handler (`GET`, `POST`, ...).
   */
  readonly endpoint: <
    Params extends Record<string, string> = any,
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
 * import { makeServerRuntime } from '@thomasfosterau/effect-svelte/kit/server';
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
): ServerRuntime<R, E> => {
  const runtime = ManagedRuntime.make((layer ?? Layer.empty) as Layer.Layer<R, E>);

  const runExit = <A>(
    event: RequestEvent,
    effect: Effect.Effect<A, unknown, R | SvelteKitServices>,
  ): Promise<Exit.Exit<A, unknown>> => {
    const provided = Effect.provide(effect, requestLayer(event)) as Effect.Effect<A, unknown, R>;
    return runtime.runPromiseExit(provided) as Promise<Exit.Exit<A, unknown>>;
  };

  const run = <A>(
    event: RequestEvent,
    effect: Effect.Effect<A, unknown, R | SvelteKitServices>,
  ): Promise<A> => runExit(event, effect).then(settle);

  const action: ServerRuntime<R, E>["action"] = (fn) => (event) => run(event, fn(event));

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
    handle: (fn) => (input) => run(input.event, fn(input)),
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
    Params extends Record<string, string> = any,
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
 * import { makeUniversalRuntime } from '@thomasfosterau/effect-svelte/kit';
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
