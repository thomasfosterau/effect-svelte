/**
 * Create SvelteKit server endpoints (`+server.ts`) backed by Effect — the
 * `Endpoint` namespace of `@thomasfosterau/effect-sveltekit/server`.
 *
 * A SvelteKit endpoint is a `RequestHandler` (`(event) => Response`). Effect can
 * turn an [`HttpApi`](https://effect.website), an `HttpRouter`, or a single
 * route effect into a Web `fetch` handler; these helpers wrap one as a SvelteKit
 * endpoint handler so a route can be served by Effect. Mount it on a catch-all
 * route (`[...path]`) and assign it to `fallback` so every method and sub-path
 * reaches it:
 *
 * @example
 * ```ts
 * // src/routes/api/[...path]/+server.ts
 * import { Endpoint } from "@thomasfosterau/effect-sveltekit/server";
 * import { api } from "#lib/server/api.ts";
 * import { ApiLive } from "#lib/server/handlers.ts"; // HttpApiBuilder.group(...) + your services
 *
 * // `prefix` strips the SvelteKit mount path so the API's own paths
 * // (e.g. "/users") match.
 * export const fallback = Endpoint.fromApi(api, ApiLive, { prefix: "/api" });
 * ```
 *
 * The layer backing an endpoint is built once, lazily, on the first request and
 * shared across subsequent requests (like `makeServerRuntime`). The returned
 * handler carries a `dispose()` that closes the layer's scope — call it on
 * shutdown if the endpoint holds resources.
 *
 * The Effect handlers receive an Effect-native `HttpServerRequest` (built from
 * `event.request`), not the SvelteKit `RequestEvent`.
 */

import type { RequestHandler } from "@sveltejs/kit";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import type * as Scope from "effect/Scope";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Etag from "effect/http/Etag";
import * as HttpEffect from "effect/http/HttpEffect";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";
import type * as HttpServerResponse from "effect/http/HttpServerResponse";
import type * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import type * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { encodeRetry, encodeSseFrame, HEARTBEAT_FRAME, SSE_HEADERS } from "../internal/sse.js";

/** A Web `fetch`-style handler, as produced by Effect's `toWebHandler` family. */
type WebHandler = (request: Request) => Promise<Response>;

/** A Web handler that also accepts a per-request service context. */
type WebHandlerWithContext = (
  request: Request,
  context?: Context.Context<never>,
) => Promise<Response>;

/**
 * Resolve a request-scoped service context, if a resolver was given. The
 * resolver may return a `Context` directly or an `Effect` producing one (run
 * with no requirements), so a consumer can read the request to build
 * session-aware services per dispatch.
 */
export type RequestContext<RequestServices> = (
  request: Request,
) =>
  | Context.Context<RequestServices>
  | Effect.Effect<Context.Context<RequestServices>, never, never>;

const resolveRequestContext = async <RequestServices>(
  request: Request,
  context: RequestContext<RequestServices> | undefined,
): Promise<Context.Context<RequestServices> | undefined> => {
  if (context === undefined) return undefined;
  const result = context(request);
  return Effect.isEffect(result) ? Effect.runPromise(result) : result;
};

/**
 * A SvelteKit endpoint handler — the built-in
 * [`RequestHandler`](https://svelte.dev/docs/kit/@sveltejs-kit#RequestHandler) —
 * backed by an Effect HTTP construct. Assign it to a `+server.ts` export
 * (`fallback`, `GET`, ...). `dispose()` closes the scope of the layer behind it.
 */
export type EndpointHandler = RequestHandler & {
  /** Close the scope of the layer backing the endpoint (runs its finalizers). */
  readonly dispose: () => Promise<void>;
};

/** Shared options for every `Endpoint.from*` helper. */
export interface EndpointOptions {
  /**
   * A leading path segment to strip from each request before it reaches the
   * Effect handler — the SvelteKit mount point. For an endpoint mounted at
   * `src/routes/api/[...path]/+server.ts` whose routes are defined relative to
   * the API root, pass `prefix: "/api"` so `/api/users` is dispatched as
   * `/users`. The match respects path boundaries (`/api` does not strip
   * `/apiary`). Defaults to no stripping.
   */
  readonly prefix?: string;
}

const noopDispose = (): Promise<void> => Promise.resolve();

/** Remove `prefix` from the request's path (respecting `/` boundaries). */
const stripPrefix = (request: Request, prefix: string): Request => {
  const normalized = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  if (normalized === "") return request;

  const url = new URL(request.url);
  const path = url.pathname;
  if (path === normalized) {
    url.pathname = "/";
  } else if (path.startsWith(`${normalized}/`)) {
    url.pathname = path.slice(normalized.length);
  } else {
    return request;
  }
  return new Request(url, request);
};

/** Wrap a Web handler (and its dispose) as a SvelteKit endpoint handler. */
const make = <RequestServices = never>(
  webHandler: WebHandler | WebHandlerWithContext,
  dispose: () => Promise<void>,
  prefix: string | undefined,
  context?: RequestContext<RequestServices>,
): EndpointHandler => {
  const handler: RequestHandler = async (event) => {
    const request = prefix === undefined ? event.request : stripPrefix(event.request, prefix);
    if (context === undefined) return (webHandler as WebHandler)(request);
    const ctx = await resolveRequestContext(request, context);
    return (webHandler as WebHandlerWithContext)(
      request,
      ctx as Context.Context<never> | undefined,
    );
  };
  return Object.assign(handler, { dispose });
};

/** The platform services an `HttpApi` needs, with a no-op file system. */
const apiPlatform = Layer.mergeAll(Path.layer, Etag.layerWeak, HttpPlatform.layer).pipe(
  Layer.provideMerge(FileSystem.layerNoop({})),
);

/**
 * Create a SvelteKit endpoint that serves an Effect
 * [`HttpApi`](https://effect.website).
 *
 * `layer` implements the API's groups (built with `HttpApiBuilder.group`), with
 * any application services already provided. The platform services an `HttpApi`
 * requires (`HttpPlatform`, `FileSystem`, `Path`, `Etag`) are supplied for you.
 *
 * @example
 * ```ts
 * // src/routes/api/[...path]/+server.ts
 * import { Endpoint } from "@thomasfosterau/effect-sveltekit/server";
 * import { api } from "#lib/server/api.ts";
 * import { ApiLive } from "#lib/server/handlers.ts";
 *
 * export const fallback = Endpoint.fromApi(api, ApiLive, { prefix: "/api" });
 * ```
 */
export const fromApi = <
  Id extends string,
  Groups extends HttpApiGroup.Constraint,
  E,
  LayerRequires = never,
  RequestServices = never,
>(
  api: HttpApi.HttpApi<Id, Groups>,
  layer: Layer.Layer<HttpApiGroup.ToService<Id, Groups>, E, LayerRequires>,
  options?: EndpointOptions & {
    /** Serve the OpenAPI spec for the API at this path (e.g. `"/openapi.json"`). */
    readonly openapiPath?: `/${string}`;
    /** Add Effect's request logger middleware. Defaults to `false` (quiet). */
    readonly logger?: boolean;
    /**
     * Provide the request-scoped services the API groups require, per request.
     * The build-once platform layer (`HttpPlatform` / `FileSystem` / `Path` /
     * `Etag`) stays shared; only this slice is resolved and merged for each
     * dispatch — so a session-aware, request-pooled API can run on Workers
     * without rebuilding its platform layer.
     *
     * The resolver may return a `Context` or an `Effect` producing one. Leave
     * the matching services unprovided in `layer` and supply them here:
     *
     * ```ts
     * Endpoint.fromApi(api, ApiLive, {
     *   prefix: "/api",
     *   context: (request) => Context.make(CurrentUser, userFor(request)),
     * });
     * ```
     */
    readonly context?: RequestContext<RequestServices>;
  },
): EndpointHandler => {
  const appLayer = HttpApiBuilder.layer(
    api,
    options?.openapiPath ? { openapiPath: options.openapiPath } : undefined,
  ).pipe(Layer.provide(layer), Layer.provide(apiPlatform));

  // The request-scoped services are supplied per dispatch via the web handler's
  // context argument, so they are hidden from the build-once layer here.
  const { handler, dispose } = HttpRouter.toWebHandler(
    appLayer as unknown as Layer.Layer<never, E, HttpRouter.HttpRouter>,
    { disableLogger: options?.logger !== true },
  );
  return make<RequestServices>(
    handler as WebHandlerWithContext,
    dispose,
    options?.prefix,
    options?.context,
  );
};

/**
 * Create a SvelteKit endpoint that serves an Effect `HttpRouter` (provided by
 * `layer`). The router's routes must be self-contained (any services they need
 * are provided within `layer`).
 *
 * @example
 * ```ts
 * // src/routes/api/[...path]/+server.ts
 * import { Endpoint } from "@thomasfosterau/effect-sveltekit/server";
 * import { Effect } from "effect";
 * import { HttpRouter, HttpServerResponse } from "effect/http";
 *
 * const RouterLive = HttpRouter.use((router) =>
 *   router.add("GET", "/hello", Effect.succeed(HttpServerResponse.text("hi"))),
 * );
 *
 * export const fallback = Endpoint.fromRouter(RouterLive, { prefix: "/api" });
 * ```
 */
export const fromRouter = <
  A,
  E,
  R extends
    | HttpRouter.HttpRouter
    | HttpRouter.Request<"Requires", any>
    | HttpRouter.Request<"GlobalRequires", any>
    | HttpRouter.Request<"Error", any>
    | HttpRouter.Request<"GlobalError", any>,
  RequestServices = never,
>(
  layer: Layer.Layer<A, E, R>,
  options?: EndpointOptions & {
    /** Add Effect's request logger middleware. Defaults to `false` (quiet). */
    readonly logger?: boolean;
    /**
     * Provide the request-scoped services the router's routes require, per
     * request (the routes' `HttpRouter.Request<"Requires", ...>` services). The
     * resolver may return a `Context` or an `Effect` producing one.
     */
    readonly context?: RequestContext<RequestServices>;
  },
): EndpointHandler => {
  const { handler, dispose } = HttpRouter.toWebHandler(layer, {
    disableLogger: options?.logger !== true,
  });
  return make<RequestServices>(
    handler as WebHandlerWithContext,
    dispose,
    options?.prefix,
    options?.context,
  );
};

/**
 * Create a SvelteKit endpoint from a single Effect HTTP route — an effect
 * producing an `HttpServerResponse` for the current `HttpServerRequest`. Pass
 * `options.layer` to provide the route's services; the layer is built once and
 * shared.
 *
 * @example
 * ```ts
 * // src/routes/health/+server.ts
 * import { Endpoint } from "@thomasfosterau/effect-sveltekit/server";
 * import { Effect } from "effect";
 * import { HttpServerResponse } from "effect/http";
 *
 * export const GET = Endpoint.fromHttpEffect(
 *   Effect.succeed(HttpServerResponse.text("ok")),
 * );
 * ```
 */
export const fromHttpEffect = <E, R = never, ProvidedE = never>(
  effect: Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    E,
    R | HttpServerRequest.HttpServerRequest | Scope.Scope
  >,
  options?: EndpointOptions & {
    /** A layer providing the route's services (`R`), built once and shared. */
    readonly layer?: Layer.Layer<R, ProvidedE>;
  },
): EndpointHandler => {
  if (options?.layer) {
    const { handler, dispose } = HttpEffect.toWebHandlerLayer(effect, options.layer);
    return make(handler as WebHandler, dispose, options.prefix);
  }
  const handler = HttpEffect.toWebHandler(
    effect as Effect.Effect<
      HttpServerResponse.HttpServerResponse,
      E,
      HttpServerRequest.HttpServerRequest | Scope.Scope
    >,
  );
  return make(handler, noopDispose, options?.prefix);
};

/** Options for {@link fromStream}: how to frame each element as an SSE event. */
export interface FromStreamOptions<A, R = never> {
  /**
   * The event name (`event:` field). A string applies to every element, or a
   * function derives it per element (return `undefined` for an unnamed event).
   * Omit for the default unnamed `message` events.
   */
  readonly event?: string | ((value: A) => string | undefined);
  /**
   * Encode an element into the `data:` payload. Defaults to `JSON.stringify`.
   * Multi-line output is split across multiple `data:` lines automatically.
   */
  readonly data?: (value: A) => string;
  /** Derive an event id (`id:` field) the browser echoes on reconnect. */
  readonly id?: (value: A) => string | undefined;
  /**
   * The client reconnection delay in milliseconds, sent once as a leading
   * `retry:` field. The browser's `EventSource` reconnects automatically after
   * this delay when the connection drops.
   */
  readonly retry?: number;
  /**
   * Send a comment heartbeat on this interval to keep the connection alive
   * through proxies that time out idle streams. Accepts any `Duration.Input`
   * (e.g. `"30 seconds"`).
   */
  readonly heartbeat?: Duration.Input;
  /**
   * A layer (or context) providing the stream's services `R`, applied per
   * connection. Omit when the stream is self-contained (`R = never`).
   */
  readonly provide?: Layer.Layer<R> | Context.Context<R>;
}

/**
 * Create a SvelteKit endpoint that streams an Effect `Stream` to the browser as
 * [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
 * (`text/event-stream`). Consume it client-side with `Realtime.fromEventSource`
 * (from `@thomasfosterau/effect-sveltekit/client`) or the native `EventSource`.
 *
 * Each element is framed as one SSE event (`event` / `id` optional, `data`
 * defaults to JSON). A `retry` sets the reconnect delay; a `heartbeat` keeps
 * idle connections alive. The response closes when the stream ends; the stream
 * is interrupted (running its finalizers) when the client disconnects.
 *
 * @example
 * ```ts
 * // src/routes/events/+server.ts
 * import { Endpoint } from "@thomasfosterau/effect-sveltekit/server";
 * import { Schedule, Stream } from "effect";
 *
 * const ticks = Stream.fromSchedule(Schedule.spaced("1 second"));
 *
 * export const GET = Endpoint.fromStream(ticks, {
 *   event: "tick",
 *   heartbeat: "30 seconds",
 *   retry: 3000,
 * });
 * ```
 */
export const fromStream = <A, E, R = never>(
  stream: Stream.Stream<A, E, R>,
  options?: FromStreamOptions<A, R>,
): RequestHandler => {
  const encodeData = options?.data ?? ((value: A): string => JSON.stringify(value));
  const eventOf = (value: A): string | undefined =>
    typeof options?.event === "function" ? options.event(value) : options?.event;

  return (event) => {
    // Frame each element, then encode the resulting strings to bytes.
    const events = stream.pipe(
      Stream.map((value) =>
        encodeSseFrame({
          data: encodeData(value),
          event: eventOf(value),
          id: options?.id?.(value),
        }),
      ),
    );

    // A leading `retry:` field, if configured.
    const withRetry =
      options?.retry === undefined ? events : Stream.prepend(events, [encodeRetry(options.retry)]);

    // Merge in a heartbeat that halts as soon as the data stream ends.
    const framed =
      options?.heartbeat === undefined
        ? withRetry
        : Stream.merge(
            withRetry,
            Stream.fromSchedule(Schedule.spaced(options.heartbeat)).pipe(
              Stream.map(() => HEARTBEAT_FRAME),
            ),
            { haltStrategy: "left" },
          );

    const bytes = Stream.encodeText(framed);
    const provided =
      options?.provide === undefined ? bytes : Stream.provide(bytes, options.provide);

    const body = Stream.toReadableStream(provided as Stream.Stream<Uint8Array, E>);

    // SvelteKit forwards a streaming body Response as-is.
    void event;
    return new Response(body, { headers: { ...SSE_HEADERS } });
  };
};
