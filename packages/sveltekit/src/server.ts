import type { Action, Actions, HttpError, Redirect, RequestEvent, ServerLoad } from "@sveltejs/kit";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Cause from "effect/Cause";
import * as Console from "effect/Console";
import { isHttpError, isRedirect } from "@sveltejs/kit";
import type { SvelteKitServices } from "./app-runtime.js";
import type { ActionFailureOf } from "./kit.js";
import type { SvelteRouteId, SvelteRouteParams } from "./internal/route-params.js";
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
 * import * as HttpClient from 'effect/http/HttpClient';
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
  RouteId extends SvelteRouteId = any,
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
 * A `SvelteKit.fail(status, data)` failure in the Effect's error type is the
 * action's result, as the `ActionFailure` SvelteKit's `fail()` builds (so the
 * route's `ActionData` includes `data`). SvelteKit control flow (`redirect()`,
 * `error()`) is passed through to SvelteKit, and any other failure is thrown
 * as an `EffectCauseError` (a 500).
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
  RouteId extends SvelteRouteId = any,
  E = unknown,
>(
  fn: (event: RequestEvent<Params, RouteId>) => Effect.Effect<OutputData, E, SvelteKitServices>,
): Action<Params, OutputData | ActionFailureOf<E>, RouteId> {
  return runtime().action(fn);
}

/**
 * Creates SvelteKit actions from an object of Effect-based action handlers.
 * Each action will have access to platform services via the SvelteKit runtime,
 * and settles as {@link action} does: a `SvelteKit.fail()` failure is its
 * result, any other failure is thrown.
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
  RouteId extends SvelteRouteId = any,
  E = unknown,
>(
  actionsMap: Record<
    string,
    (event: RequestEvent<Params, RouteId>) => Effect.Effect<OutputData, E, SvelteKitServices>
  >,
): Actions<Params, OutputData | ActionFailureOf<E>, RouteId> {
  return runtime().actions(actionsMap);
}

/** Whether a squashed failure is SvelteKit's own `redirect()` / `error()`. */
const isKitControlFlow = (squashed: unknown): squashed is Redirect | HttpError =>
  isRedirect(squashed) || isHttpError(squashed);

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
 * import * as HttpClient from 'effect/http/HttpClient';
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
  RouteId extends SvelteRouteId = any,
>(
  fn: (event: RequestEvent<Params, RouteId>) => Effect.Effect<Response, unknown, SvelteKitServices>,
  options?: { exposeErrors?: boolean },
): (event: RequestEvent<Params, RouteId>) => Promise<Response> {
  const { exposeErrors = false } = options ?? {};

  return async (event) => {
    const exit = await runtime().runPromiseExit(
      event,
      // Always log the full error server-side for debugging, as part of the
      // request's own Effect: through the runtime's `Console` (the global
      // console by default). SvelteKit's control flow objects are not errors.
      fn(event).pipe(
        Effect.tapCause((cause) =>
          isKitControlFlow(Cause.squash(cause))
            ? Effect.void
            : Console.error("Endpoint error:", Cause.pretty(cause)),
        ),
      ),
    );

    return Exit.match(exit, {
      onFailure: (cause) => {
        // Let SvelteKit handle its own control flow objects.
        const squashed = Cause.squash(cause);
        if (isKitControlFlow(squashed)) {
          throw squashed;
        }

        // Return generic error message to client unless explicitly enabled
        const clientMessage = exposeErrors ? Cause.pretty(cause) : "Internal server error";

        // `Response.json` serialises the body and sets `Content-Type: application/json`.
        return Response.json({ error: clientMessage }, { status: 500 });
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
export { RemoteFunction, RemoteFunctionUsageError } from "./remote-functions.js";

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
 * Streamed load helper. {@link defer} captures the current service context and
 * runs a slow Effect in the background, returning the `Promise` so SvelteKit
 * can stream the result to the browser while sending the initial HTML
 * immediately. Use inside `serverLoad` alongside eagerly-computed fields.
 */
export { defer } from "./streamed-load.js";

/**
 * Effect-native SvelteKit control-flow helpers and the default boundary
 * translator.
 *
 * - `SvelteKit.redirect` / `SvelteKit.error` / `SvelteKit.fail` — yield typed
 *   Effect failures instead of throwing SvelteKit control-flow objects.
 * - `SvelteKit.translate` — the default `translateError` wired into every
 *   server wrapper; throws the Kit error types as `redirect()` / `error()` at
 *   the request boundary.
 * - `SvelteKit.failuresReturned` — what the action wrappers apply: a
 *   `SvelteKit.fail()` failure becomes the Effect's result, as `fail()`'s
 *   `ActionFailure`.
 * - `SvelteKit.makeTranslator([...cases])` — compose `translate` with your own
 *   domain-error matchers (consumer cases run before the Kit base cases).
 * - `KitErrorTranslator` — the translator contract (throw-only);
 *   `KitActionErrorTranslator` — a form action's, which may return `fail()`.
 * - `ActionFailureOf` — the `ActionFailure` an action returns for the
 *   `SvelteKit.fail()` failures in an Effect's error type.
 * - `KitRedirect`, `KitError`, `KitActionFailure` — the tagged error classes
 *   for use with `Effect.catchTag`, `instanceof`, etc.
 * - `KitTranslatorCase` — the argument type for `makeTranslator`.
 * - `KitErrorBody` — the body `SvelteKit.error` / `KitError` carry.
 */
export {
  SvelteKit,
  KitRedirect,
  KitError,
  KitActionFailure,
  type KitTranslatorCase,
  type KitErrorTranslator,
  type KitActionErrorTranslator,
  type ActionFailureOf,
} from "./kit.js";
export type { KitErrorBody } from "./internal/error.js";

/**
 * A `translateError` built from a tag-keyed catalogue:
 * `Errors.toSvelteKit({ NotFound: 404, Forbidden: 403, Redirect: "redirect", HttpError: "status" })`.
 * Pass it to `makeRuntimeAdapter` / `RemoteFunction.withRuntime`; see
 * {@link Errors.toSvelteKit}.
 */
export * as Errors from "./errors.js";

/** The response-headers buffer, re-exported from the universal entry for server-only modules. */
export { ResponseHeaders } from "./response-headers.js";

/**
 * Effect-native services for the three per-request surfaces of a SvelteKit
 * `RequestEvent`: cookies, response headers, and locals.
 *
 * Each is a tagged `Context.Service` that is provided automatically in every
 * server handler effect (part of {@link SvelteKitServices}). Use
 * `yield* SvelteKitCookies` / `yield* SvelteKitResponseHeaders` /
 * `yield* SvelteKitLocals` to access them; stub them with `Layer.succeed` in
 * tests without a real `RequestEvent`.
 */
export {
  SvelteKitCookies,
  SvelteKitResponseHeaders,
  SvelteKitLocals,
  requestServicesLayer,
  type SvelteKitCookiesInterface,
  type SvelteKitResponseHeadersInterface,
} from "./request-services.js";
