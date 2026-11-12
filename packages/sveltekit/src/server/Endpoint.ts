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
import { identity } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
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
import { runPromise } from "../internal/run.js";
import { builtWithRouterOnly } from "../internal/unchecked.js";
import { encodeRetry, encodeSseFrame, HEARTBEAT_FRAME, SSE_HEADERS } from "../internal/sse.js";

/** A Web handler that also accepts a per-request service context. */
type WebHandlerWithContext = (
  request: Request,
  context?: Context.Context<never>,
) => Promise<Response>;

/**
 * Resolves a request-scoped service context. The resolver may return a
 * `Context` directly or an `Effect` producing one (run with no requirements),
 * so a consumer can read the request to build session-aware services per
 * dispatch.
 */
export type RequestContext<RequestServices> = (
  request: Request,
) => Context.Context<RequestServices> | Effect.Effect<Context.Context<RequestServices>>;

/** Run `context` for `request`; a failing or dying resolver Effect rejects. */
const resolveRequestContext = async <RequestServices>(
  request: Request,
  context: RequestContext<RequestServices>,
): Promise<Context.Context<RequestServices>> => {
  const result = context(request);
  return Effect.isEffect(result) ? runPromise(result) : result;
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

/** What {@link make} reads from a `from*` helper's options. */
interface MakeOptions<RequestServices> extends EndpointOptions {
  /** Resolves the request-scoped services passed to the Web handler on each dispatch. */
  readonly context?: RequestContext<RequestServices>;
}

/**
 * Wrap a Web handler (and its dispose) as a SvelteKit endpoint handler, reading
 * `prefix` and `context` from the helper's own `options`.
 */
const make = <RequestServices = never>(
  webHandler: WebHandlerWithContext,
  dispose: () => Promise<void>,
  options: MakeOptions<RequestServices> = {},
): EndpointHandler => {
  const { prefix, context } = options;
  const handler: RequestHandler = async (event) => {
    const request = prefix === undefined ? event.request : stripPrefix(event.request, prefix);
    if (context === undefined) return webHandler(request);
    const ctx = await resolveRequestContext(request, context);
    return webHandler(request, ctx);
  };
  return Object.assign(handler, { dispose });
};

/** The router layers `HttpRouter.toWebHandler` accepts: what `R` may be. */
type RouterRequirements =
  Parameters<typeof HttpRouter.toWebHandler>[0] extends Layer.Layer<
    infer _A,
    infer _E,
    infer Requirements
  >
    ? Requirements
    : never;

/**
 * `HttpRouter.toWebHandler` for a router layer, with the handler typed as a
 * {@link WebHandlerWithContext}: the request-scoped context is optional.
 *
 * `toWebHandler` types its handler by a conditional on `ReqR`, the
 * request-scoped services the routes still require, which defaults to a type
 * computed from the layer and stays unresolved while the layer's `R` is
 * generic. `ReqR` is `toWebHandler`'s own type parameter; here it is given as
 * `never`, which nothing checks: the `from*` helpers take the request-scoped
 * services from their `context` option and pass them on each dispatch
 * ({@link make}), and a route that asks for a service no context supplied dies
 * with Effect's "Service not found" defect. This function is the one place
 * that claim is made.
 */
const routerWebHandler = <A, E, R extends RouterRequirements>(
  layer: Layer.Layer<A, E, R>,
  logger?: boolean,
): { readonly handler: WebHandlerWithContext; readonly dispose: () => Promise<void> } =>
  HttpRouter.toWebHandler<A, E, R, never, never, never>(layer, {
    disableLogger: logger !== true,
  });

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
  // The layer's remaining requirements beyond `HttpRouter` are the groups'
  // request services, which `make` supplies on each dispatch from the context
  // `options.context` resolves.
  const { handler, dispose } = routerWebHandler(builtWithRouterOnly(appLayer), options?.logger);
  return make<RequestServices>(handler, dispose, options);
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
  const { handler, dispose } = routerWebHandler(layer, options?.logger);
  return make<RequestServices>(handler, dispose, options);
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
export function fromHttpEffect<E, R, ProvidedE>(
  effect: Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    E,
    R | HttpServerRequest.HttpServerRequest | Scope.Scope
  >,
  options: EndpointOptions & {
    /** A layer providing the route's services (`R`), built once and shared. */
    readonly layer: Layer.Layer<R, ProvidedE>;
  },
): EndpointHandler;
/**
 * Create a SvelteKit endpoint from a single self-contained Effect HTTP route:
 * one that requires nothing beyond the current `HttpServerRequest` and its
 * `Scope`.
 */
export function fromHttpEffect<E>(
  effect: SelfContainedRoute<E>,
  options: EndpointOptions & { readonly layer?: never },
): EndpointHandler;
/**
 * Create a SvelteKit endpoint from a single self-contained Effect HTTP route:
 * one that requires nothing beyond the current `HttpServerRequest` and its
 * `Scope`.
 */
export function fromHttpEffect<E>(effect: SelfContainedRoute<E>): EndpointHandler;
export function fromHttpEffect<E, R, ProvidedE>(
  ...args: FromHttpEffectArgs<E, R, ProvidedE>
): EndpointHandler {
  if (routeHasLayer(args)) {
    const { handler, dispose } = layeredWebHandler(args[0], args[1].layer);
    return make(handler, dispose, args[1]);
  }
  return make(HttpEffect.toWebHandler(args[0]), noopDispose, args[1]);
}

/** A route that requires nothing beyond the request and its scope. */
type SelfContainedRoute<E> = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  E,
  HttpServerRequest.HttpServerRequest | Scope.Scope
>;

/**
 * The two ways {@link fromHttpEffect} is called, as its overloads spell them:
 * with a self-contained route, or with a route and the layer that provides
 * the services `R` it requires.
 */
type FromHttpEffectArgs<E, R, ProvidedE> =
  | readonly [effect: SelfContainedRoute<E>, options?: EndpointOptions & { readonly layer?: never }]
  | readonly [
      effect: Effect.Effect<
        HttpServerResponse.HttpServerResponse,
        E,
        R | HttpServerRequest.HttpServerRequest | Scope.Scope
      >,
      options: EndpointOptions & { readonly layer: Layer.Layer<R, ProvidedE> },
    ];

/** Whether {@link fromHttpEffect} was called with a layer. */
const routeHasLayer = <E, R, ProvidedE>(
  args: FromHttpEffectArgs<E, R, ProvidedE>,
): args is Extract<
  FromHttpEffectArgs<E, R, ProvidedE>,
  readonly [unknown, { readonly layer: Layer.Layer<R, ProvidedE> }]
> => args[1]?.layer !== undefined;

/**
 * `HttpEffect.toWebHandlerLayer` for a route whose services `layer` provides
 * in full, with the handler typed as a {@link WebHandlerWithContext}.
 *
 * `toWebHandlerLayer` types its handler by a conditional on `ReqR`, the
 * services the route still requires per request:
 * `Exclude<R | HttpServerRequest | Scope, R | Scope | HttpServerRequest>`,
 * which is `never` but which TypeScript does not resolve while `R` is generic.
 * `ReqR` is `toWebHandlerLayer`'s own type parameter, given here as the
 * `never` it comes to.
 */
const layeredWebHandler = <E, R, ProvidedE>(
  effect: Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    E,
    R | HttpServerRequest.HttpServerRequest | Scope.Scope
  >,
  layer: Layer.Layer<R, ProvidedE>,
): { readonly handler: WebHandlerWithContext; readonly dispose: () => Promise<void> } =>
  HttpEffect.toWebHandlerLayer<
    E,
    R | HttpServerRequest.HttpServerRequest | Scope.Scope,
    R,
    ProvidedE,
    never
  >(effect, layer);

/** Options for {@link fromStream}: how to frame each element as an SSE event. */
export interface FromStreamOptions<A, R = never> {
  /**
   * The event name (`event:` field). A string applies to every element, or a
   * function derives it per element as an `Option`: `Some(name)` names the
   * event, `None` omits the field (an unnamed `message` event). Omit for the
   * default unnamed `message` events.
   */
  readonly event?: string | ((value: A) => Option.Option<string>);
  /**
   * Encode an element into the `data:` payload. Defaults to JSON (an element
   * JSON cannot represent, such as a `bigint`, ends the stream with a defect).
   * Multi-line output is split across multiple `data:` lines automatically.
   */
  readonly data?: (value: A) => string;
  /**
   * Derive an event id (`id:` field) the browser echoes on reconnect, as an
   * `Option`: `Some(id)` sends the field, `None` omits it for that element.
   */
  readonly id?: (value: A) => Option.Option<string>;
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

/** `fromStream`'s default `data:` encoder: the element as a JSON string. */
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/**
 * Create a SvelteKit endpoint that streams an Effect `Stream` to the browser as
 * [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
 * (`text/event-stream`). Consume it client-side with `Realtime.fromEventSource`
 * (from `@thomasfosterau/effect-sveltekit/client`) or the native `EventSource`.
 *
 * Each element is framed as one SSE event (`event` / `id` optional — their
 * per-element callbacks return an `Option`, `None` omitting the field — and
 * `data` defaults to JSON). A `retry` sets the reconnect delay; a `heartbeat` keeps
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
export function fromStream<A, E, R>(
  stream: Stream.Stream<A, E, R>,
  options: FromStreamOptions<A, R> & {
    /** A layer (or context) providing the stream's services `R`, applied per connection. */
    readonly provide: Layer.Layer<R> | Context.Context<R>;
  },
): RequestHandler;
/**
 * Create a SvelteKit endpoint that streams a self-contained Effect `Stream`
 * (one that requires no services) to the browser as Server-Sent Events.
 */
export function fromStream<A, E>(
  stream: Stream.Stream<A, E>,
  options: FromStreamOptions<A> & { readonly provide?: never },
): RequestHandler;
/**
 * Create a SvelteKit endpoint that streams a self-contained Effect `Stream`
 * (one that requires no services) to the browser as Server-Sent Events, each
 * element an unnamed `message` event with a JSON `data:` payload.
 */
export function fromStream<A, E>(stream: Stream.Stream<A, E>): RequestHandler;
export function fromStream<A, E, R>(...args: FromStreamArgs<A, E, R>): RequestHandler {
  return streamHasProvider(args)
    ? sseHandler(args[0], args[1], providing(args[1].provide))
    : sseHandler(args[0], args[1], identity);
}

/**
 * The two ways {@link fromStream} is called, as its overloads spell them: with
 * a self-contained stream, or with a stream and what provides the services
 * `R` it requires.
 */
type FromStreamArgs<A, E, R> =
  | readonly [
      stream: Stream.Stream<A, E>,
      options?: FromStreamOptions<A> & { readonly provide?: never },
    ]
  | readonly [
      stream: Stream.Stream<A, E, R>,
      options: FromStreamOptions<A, R> & {
        readonly provide: Layer.Layer<R> | Context.Context<R>;
      },
    ];

/** Whether {@link fromStream} was called with a `provide` option. */
const streamHasProvider = <A, E, R>(
  args: FromStreamArgs<A, E, R>,
): args is Extract<
  FromStreamArgs<A, E, R>,
  readonly [unknown, { readonly provide: Layer.Layer<R> | Context.Context<R> }]
> => args[1]?.provide !== undefined;

/** Provides the services `R` a connection's byte stream requires. */
type ProvideStream<E, R> = (bytes: Stream.Stream<Uint8Array, E, R>) => Stream.Stream<Uint8Array, E>;

/**
 * Provides `context` to a connection's byte stream, as `Stream.provideContext`
 * does (written with `Stream.updateContext`, whose result type states the
 * requirements left rather than an `Exclude` TypeScript cannot resolve for a
 * generic `R`).
 */
const provideContextTo = <E, R>(
  bytes: Stream.Stream<Uint8Array, E, R>,
  context: Context.Context<R>,
): Stream.Stream<Uint8Array, E> =>
  Stream.updateContext(bytes, (current: Context.Context<never>) => Context.merge(current, context));

/**
 * {@link FromStreamOptions.provide} as a {@link ProvideStream}: a context is
 * provided as is, and a layer is built in the connection's stream scope (so it
 * is released when the stream ends) and its services provided.
 */
const providing =
  <E, R>(provide: Layer.Layer<R> | Context.Context<R>): ProvideStream<E, R> =>
  (bytes) =>
    Context.isContext(provide)
      ? provideContextTo(bytes, provide)
      : Stream.unwrap(
          Effect.map(Layer.build(provide), (context) => provideContextTo(bytes, context)),
        );

/**
 * The SSE endpoint for `stream`: each connection frames the stream's elements
 * as events and `provide` supplies the services it requires (see
 * {@link fromStream}).
 */
const sseHandler = <A, E, R>(
  stream: Stream.Stream<A, E, R>,
  options: Omit<FromStreamOptions<A>, "provide"> = {},
  provide: ProvideStream<E, R>,
): RequestHandler => {
  const encodeData = options.data ?? encodeJson;
  // The element's `event:` name and `id:`: `None` leaves the field out.
  const eventOf = (value: A): Option.Option<string> => {
    const name = options.event;
    return P.isFunction(name) ? name(value) : Option.fromUndefinedOr(name);
  };
  const idOf = (value: A): Option.Option<string> =>
    Option.flatMap(Option.fromUndefinedOr(options.id), (id) => id(value));

  return (event) => {
    // Frame each element, then encode the resulting strings to bytes.
    const events = stream.pipe(
      Stream.map((value) =>
        encodeSseFrame({
          data: encodeData(value),
          ...R.getSomes({ event: eventOf(value), id: idOf(value) }),
        }),
      ),
    );

    // A leading `retry:` field, if configured.
    const withRetry =
      options.retry === undefined ? events : Stream.prepend(events, [encodeRetry(options.retry)]);

    // Merge in a heartbeat that halts as soon as the data stream ends.
    const framed =
      options.heartbeat === undefined
        ? withRetry
        : Stream.merge(
            withRetry,
            Stream.fromSchedule(Schedule.spaced(options.heartbeat)).pipe(
              Stream.map(() => HEARTBEAT_FRAME),
            ),
            { haltStrategy: "left" },
          );

    const body = Stream.toReadableStream(provide(Stream.encodeText(framed)));

    // SvelteKit forwards a streaming body Response as-is.
    void event;
    return new Response(body, { headers: { ...SSE_HEADERS } });
  };
};
