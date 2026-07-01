import type { Action, Actions, RequestEvent, ServerLoad } from "@sveltejs/kit";
import { Effect, Exit, Cause } from "effect";
import { isHttpError, isRedirect } from "@sveltejs/kit";
import type { SvelteKitServices } from "./app-runtime.js";
import type { SvelteRouteParams } from "./internal/route-params.js";
import { defaultServerRuntime as runtime } from "./internal/default-runtime.js";

export type { SvelteKitServices };

/**
 * Wraps an Effect-based function to work as a SvelteKit server load function.
 * The effect has access to platform services (HttpClient, the RequestEvent, etc.)
 * via the SvelteKit runtime.
 *
 * SvelteKit control flow (`redirect()`, `error()`) raised inside the effect is
 * passed through to SvelteKit.
 *
 * To give effects access to your own application services, create an
 * app-wide runtime with {@link makeServerRuntime} and use its `serverLoad`
 * instead.
 *
 * @example
 * ```ts
 * import { serverLoad } from '@thomasfosterau/effect-sveltekit/server';
 * import { Effect } from 'effect';
 * import * as HttpClient from 'effect/unstable/http/HttpClient';
 *
 * export const load = serverLoad((event) =>
 *   Effect.gen(function* () {
 *     const client = yield* HttpClient.HttpClient;
 *     const response = yield* client.get("https://api.example.com/data");
 *     return { data: yield* response.json };
 *   })
 * );
 * ```
 */
export function serverLoad<
  Params extends SvelteRouteParams = SvelteRouteParams,
  ParentData extends Record<string, any> = any,
  OutputData extends Record<string, any> | void = any,
  RouteId extends string | null = any,
>(
  fn: (
    event: RequestEvent<Params, RouteId>,
  ) => Effect.Effect<OutputData, unknown, SvelteKitServices>,
): ServerLoad<Params, ParentData, OutputData, RouteId> {
  return runtime().serverLoad(fn);
}

/**
 * Wraps an Effect-based function to work as a SvelteKit action handler.
 * The effect has access to platform services (HttpClient, the RequestEvent, etc.)
 * via the SvelteKit runtime.
 *
 * @example
 * ```ts
 * import { action } from '@thomasfosterau/effect-sveltekit/server';
 * import { Effect } from 'effect';
 *
 * export const actions = {
 *   default: action((event) =>
 *     Effect.gen(function* () {
 *       const formData = yield* Effect.promise(() => event.request.formData());
 *       // Process form data
 *       return { success: true };
 *     })
 *   )
 * };
 * ```
 */
export function action<
  Params extends SvelteRouteParams = SvelteRouteParams,
  OutputData extends Record<string, any> | void = any,
  RouteId extends string | null = any,
>(
  fn: (
    event: RequestEvent<Params, RouteId>,
  ) => Effect.Effect<OutputData, unknown, SvelteKitServices>,
): Action<Params, OutputData, RouteId> {
  return runtime().action(fn);
}

/**
 * Creates SvelteKit actions from an object of Effect-based action handlers.
 * Each action will have access to platform services via the SvelteKit runtime.
 *
 * @example
 * ```ts
 * import { actions } from '@thomasfosterau/effect-sveltekit/server';
 * import { Effect } from 'effect';
 *
 * export const actions = actions({
 *   create: (event) => Effect.succeed({ created: true }),
 *   delete: (event) => Effect.succeed({ deleted: true })
 * });
 * ```
 */
export function actions<
  Params extends SvelteRouteParams = SvelteRouteParams,
  OutputData extends Record<string, any> | void = any,
  RouteId extends string | null = any,
>(
  actionsMap: Record<
    string,
    (event: RequestEvent<Params, RouteId>) => Effect.Effect<OutputData, unknown, SvelteKitServices>
  >,
): Actions<Params, OutputData, RouteId> {
  return runtime().actions(actionsMap);
}

/**
 * Wraps an Effect-based function to work as a SvelteKit API endpoint handler.
 * The effect has access to platform services (HttpClient, the RequestEvent, etc.)
 * via the SvelteKit runtime.
 *
 * SvelteKit control flow (`redirect()`, `error()`) raised inside the effect is
 * passed through to SvelteKit. For any other failure, the error is logged
 * server-side and a generic error message is returned to clients. For
 * development/debugging, you can pass options to expose full error details.
 *
 * @example
 * ```ts
 * import { endpoint } from '@thomasfosterau/effect-sveltekit/server';
 * import { Effect } from 'effect';
 * import { json } from '@sveltejs/kit';
 * import * as HttpClient from 'effect/unstable/http/HttpClient';
 *
 * export const GET = endpoint((event) =>
 *   Effect.gen(function* () {
 *     const client = yield* HttpClient.HttpClient;
 *     const response = yield* client.get("https://api.example.com/data");
 *     return json(yield* response.json);
 *   })
 * );
 * ```
 */
export function endpoint<
  Params extends SvelteRouteParams = SvelteRouteParams,
  RouteId extends string | null = any,
>(
  fn: (event: RequestEvent<Params, RouteId>) => Effect.Effect<Response, unknown, SvelteKitServices>,
  options?: { exposeErrors?: boolean },
): (event: RequestEvent<Params, RouteId>) => Promise<Response> {
  const { exposeErrors = false } = options ?? {};

  return async (event) => {
    const exit = await runtime().runPromiseExit(event as RequestEvent, fn(event));

    return Exit.match(exit, {
      onFailure: (cause) => {
        // Let SvelteKit handle its own control flow objects.
        const squashed = Cause.squash(cause);
        if (isRedirect(squashed) || isHttpError(squashed)) {
          throw squashed;
        }

        // Always log the full error server-side for debugging
        console.error("Endpoint error:", Cause.pretty(cause));

        // Return generic error message to client unless explicitly enabled
        const clientMessage = exposeErrors ? Cause.pretty(cause) : "Internal server error";

        return new Response(JSON.stringify({ error: clientMessage }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      },
      onSuccess: (value) => value,
    });
  };
}

/**
 * Effect wrappers for the server-side hooks (`hooks.server.ts`): the `Hooks`
 * namespace exposes `handle`, `handleFetch`, `handleError`, and `init`.
 */
export * as Hooks from "./server/Hooks.js";

/**
 * Create SvelteKit `+server.ts` endpoints backed by Effect: the `Endpoint`
 * namespace exposes `fromApi` (an `HttpApi`), `fromRouter` (an `HttpRouter`),
 * and `fromHttpEffect` (a single HTTP route effect).
 */
export * as Endpoint from "./server/Endpoint.js";

/**
 * App-wide runtime: define your application's Effect services once and share
 * them across every request.
 */
export {
  makeServerRuntime,
  type ServerRuntime,
  type ServerRuntimeOptions,
  type RequestRuntime as ScopedRequestRuntime,
} from "./app-runtime.js";

/**
 * Export the SvelteKit runtime utilities for advanced use cases.
 */
export { SvelteKitRuntime, runWithSvelteKitRuntime, SvelteKitRequestEvent } from "./runtime.js";
export { RemoteFunction } from "./remote.server.js";

/**
 * A general, Effect-idiomatic seam for *how the per-request execution context is
 * obtained*. {@link RequestRuntime} constructs a {@link RequestRuntimeProvider}
 * (from a consumer-owned runtime on `event.locals`, a package-built
 * per-request runtime, a build-once `ManagedRuntime`, or a `Layer`), and
 * {@link makeRuntimeAdapter} binds the `serverLoad` / `action` / `actions` /
 * `endpoint` wrappers to it — so the handler effect's services `R` are your own
 * application catalogue, not the fixed {@link SvelteKitServices}. A
 * {@link RuntimeAdapterOptions.translateError} maps a failed `Cause` to
 * SvelteKit control flow at the boundary.
 */
export {
  RequestRuntime,
  makeRuntimeAdapter,
  type RequestRuntimeProvider,
  type RequestRuntimeRunners,
  type RuntimeAdapter,
  type RuntimeAdapterOptions,
  type AdapterEndpointOptions,
  type FromLayerPerRequestOptions,
  type ErrorTranslator,
} from "./request-runtime.js";

/**
 * SvelteKit `$env` ⇄ Effect `Config` (see {@link sveltekitConfig}). The
 * Effect Schema ⇄ SvelteKit `transport` hook lives on the universal `Hooks`
 * namespace (`Hooks.transport`) in `@thomasfosterau/effect-sveltekit`.
 */
export { sveltekitConfig, sveltekitConfigProvider } from "./config.js";

/**
 * Schema-driven request parsing. Each helper reads a part of the current
 * request (route params, search params, JSON body, or form data), validates it
 * against an Effect `Schema` or Standard Schema V1 validator, and returns the
 * typed output. A validation failure surfaces as {@link ParseError}.
 *
 * All helpers require `SvelteKitRequestEvent` in the environment and compose
 * naturally inside `serverLoad` / `action` / `endpoint` handlers.
 */
export {
  decodeParams,
  decodeSearchParams,
  decodeJson,
  decodeFormData,
  ParseError,
  type ParseIssue,
} from "./request-parse.js";

/**
 * Effect-native SvelteKit control-flow helpers and the default boundary
 * translator.
 *
 * - `SvelteKit.redirect` / `SvelteKit.error` / `SvelteKit.fail` — yield typed
 *   Effect failures instead of throwing SvelteKit control-flow objects.
 * - `SvelteKit.translate` — the default `translateError` wired into every
 *   server wrapper; maps the Kit error types to `redirect()` / `error()` /
 *   `fail()` at the request boundary.
 * - `SvelteKit.makeTranslator([...cases])` — compose `translate` with your own
 *   domain-error matchers (consumer cases run before the Kit base cases).
 * - `KitRedirect`, `KitError`, `KitActionFailure` — the tagged error classes
 *   for use with `Effect.catchTag`, `instanceof`, etc.
 * - `KitTranslatorCase` — the argument type for `makeTranslator`.
 */
export {
  SvelteKit,
  KitRedirect,
  KitError,
  KitActionFailure,
  type KitTranslatorCase,
  type KitErrorTranslator,
} from "./kit.js";
