/**
 * Expose an Effect HTTP application as a SvelteKit server endpoint
 * (`+server.ts`), the `HttpApp` namespace of
 * `@thomasfosterau/effect-sveltekit/server`.
 *
 * Effect models HTTP a few different ways — a declarative
 * [`HttpApi`](https://effect.website), an `HttpRouter`, or a single route
 * effect — and each can be turned into a Web `fetch` handler
 * (`(request: Request) => Promise<Response>`). These helpers wrap such a handler
 * as a SvelteKit endpoint handler (`(event: RequestEvent) => Promise<Response>`)
 * so an Effect HTTP app can back a `+server.ts` route. Mount it on a catch-all
 * route (`[...path]`) and assign it to `fallback` so every method and sub-path
 * reaches the Effect app:
 *
 * @example
 * ```ts
 * // src/routes/api/[...path]/+server.ts
 * import { HttpApp } from "@thomasfosterau/effect-sveltekit/server";
 * import { api } from "$lib/server/api";
 * import { ApiLive } from "$lib/server/handlers";
 *
 * // `ApiLive` implements `api`'s groups (HttpApiBuilder.group), with any app
 * // services already provided. `prefix` strips the SvelteKit mount path so the
 * // API's own paths (e.g. "/users") match.
 * export const fallback = HttpApp.fromApi(api, ApiLive, { prefix: "/api" });
 * ```
 *
 * The layer backing an app is built once, lazily, on the first request and
 * shared across subsequent requests (like `makeServerRuntime`). The returned
 * handler carries a `dispose()` that closes the layer's scope — call it on
 * shutdown if your app holds resources.
 *
 * The Effect handlers receive an Effect-native `HttpServerRequest` (built from
 * `event.request`), not the SvelteKit `RequestEvent`.
 */

import type { RequestEvent } from "@sveltejs/kit";
import { Layer } from "effect";
import type { Effect, Scope } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Etag from "effect/unstable/http/Etag";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import * as HttpPlatform from "effect/unstable/http/HttpPlatform";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import type * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import type * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import type * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";

/** A Web `fetch`-style handler, as produced by Effect's `toWebHandler` family. */
export type WebHandler = (request: Request) => Promise<Response>;

/**
 * A SvelteKit endpoint handler backed by an Effect HTTP app. Assign it to a
 * `+server.ts` export (`fallback`, `GET`, ...). Calling `dispose()` closes the
 * scope of the layer backing the app.
 */
export interface HttpAppHandler {
  (event: RequestEvent): Promise<Response>;
  /** Close the scope of the layer backing the app (runs its finalizers). */
  readonly dispose: () => Promise<void>;
}

/** Shared options for every `HttpApp.from*` helper. */
export interface HttpAppOptions {
  /**
   * A leading path segment to strip from each request before it reaches the
   * Effect app — the SvelteKit mount point. For an app mounted at
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
const make = (
  webHandler: WebHandler,
  dispose: () => Promise<void>,
  prefix: string | undefined,
): HttpAppHandler => {
  const handler = (event: RequestEvent): Promise<Response> =>
    webHandler(prefix === undefined ? event.request : stripPrefix(event.request, prefix));
  return Object.assign(handler, { dispose });
};

/** The platform services an `HttpApi` needs, with a no-op file system. */
const apiPlatform = Layer.mergeAll(Path.layer, Etag.layerWeak, HttpPlatform.layer).pipe(
  Layer.provideMerge(FileSystem.layerNoop({})),
);

/**
 * Expose an Effect [`HttpApi`](https://effect.website) as a SvelteKit endpoint
 * handler.
 *
 * `layer` implements the API's groups (built with `HttpApiBuilder.group`), with
 * any application services already provided. The platform services an `HttpApi`
 * requires (`HttpPlatform`, `FileSystem`, `Path`, `Etag`) are supplied for you.
 *
 * @example
 * ```ts
 * // src/routes/api/[...path]/+server.ts
 * import { HttpApp } from "@thomasfosterau/effect-sveltekit/server";
 * import { api } from "$lib/server/api";
 * import { ApiLive } from "$lib/server/handlers";
 *
 * export const fallback = HttpApp.fromApi(api, ApiLive, { prefix: "/api" });
 * ```
 */
export const fromApi = <Id extends string, Groups extends HttpApiGroup.Any, E>(
  api: HttpApi.HttpApi<Id, Groups>,
  layer: Layer.Layer<HttpApiGroup.ToService<Id, Groups>, E>,
  options?: HttpAppOptions & {
    /** Serve the OpenAPI spec for the API at this path (e.g. `"/openapi.json"`). */
    readonly openapiPath?: `/${string}`;
    /** Add Effect's request logger middleware. Defaults to `false` (quiet). */
    readonly logger?: boolean;
  },
): HttpAppHandler => {
  const appLayer = HttpApiBuilder.layer(
    api,
    options?.openapiPath ? { openapiPath: options.openapiPath } : undefined,
  ).pipe(Layer.provide(layer), Layer.provide(apiPlatform));

  const { handler, dispose } = HttpRouter.toWebHandler(
    appLayer as Layer.Layer<never, E, HttpRouter.HttpRouter>,
    { disableLogger: options?.logger !== true },
  );
  return make(handler, dispose, options?.prefix);
};

/**
 * Expose an Effect `HttpRouter` (provided by `layer`) as a SvelteKit endpoint
 * handler. The router's routes must be self-contained (any services they need
 * are provided within `layer`).
 *
 * @example
 * ```ts
 * // src/routes/api/[...path]/+server.ts
 * import { HttpApp } from "@thomasfosterau/effect-sveltekit/server";
 * import { Effect, Layer } from "effect";
 * import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
 *
 * const RouterLive = HttpRouter.use((router) =>
 *   router.add("GET", "/hello", Effect.succeed(HttpServerResponse.text("hi"))),
 * );
 *
 * export const fallback = HttpApp.fromRouter(RouterLive, { prefix: "/api" });
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
>(
  layer: Layer.Layer<A, E, R>,
  options?: HttpAppOptions & {
    /** Add Effect's request logger middleware. Defaults to `false` (quiet). */
    readonly logger?: boolean;
  },
): HttpAppHandler => {
  const { handler, dispose } = HttpRouter.toWebHandler(layer, {
    disableLogger: options?.logger !== true,
  });
  return make(handler as WebHandler, dispose, options?.prefix);
};

/**
 * Expose a single Effect HTTP route — an effect producing an
 * `HttpServerResponse` for the current `HttpServerRequest` — as a SvelteKit
 * endpoint handler. Pass `options.layer` to provide the route's services; the
 * layer is built once and shared.
 *
 * @example
 * ```ts
 * // src/routes/health/+server.ts
 * import { HttpApp } from "@thomasfosterau/effect-sveltekit/server";
 * import { Effect } from "effect";
 * import { HttpServerResponse } from "effect/unstable/http";
 *
 * export const GET = HttpApp.fromHttpEffect(
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
  options?: HttpAppOptions & {
    /** A layer providing the route's services (`R`), built once and shared. */
    readonly layer?: Layer.Layer<R, ProvidedE>;
  },
): HttpAppHandler => {
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

/**
 * Expose any Web `fetch` handler — for instance the `handler` returned by
 * Effect's own `HttpRouter.toWebHandler` / `HttpEffect.toWebHandler` — as a
 * SvelteKit endpoint handler. The escape hatch the other helpers build on.
 *
 * @example
 * ```ts
 * import { HttpApp } from "@thomasfosterau/effect-sveltekit/server";
 * import { HttpRouter } from "effect/unstable/http";
 *
 * const { handler, dispose } = HttpRouter.toWebHandler(RouterLive);
 * export const fallback = HttpApp.fromWebHandler(handler, { dispose, prefix: "/api" });
 * ```
 */
export const fromWebHandler = (
  webHandler: WebHandler,
  options?: HttpAppOptions & {
    /** Disposer for whatever backs the handler, exposed as `.dispose`. */
    readonly dispose?: () => Promise<void>;
  },
): HttpAppHandler => make(webHandler, options?.dispose ?? noopDispose, options?.prefix);
