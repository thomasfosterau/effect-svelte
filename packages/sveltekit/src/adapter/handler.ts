/**
 * Runtime handler for the Effect SvelteKit adapter.
 *
 * `makeHandler` turns a built SvelteKit app (the `server` instance the adapter
 * generates with `builder.generateServerInstance`) into an Effect HTTP application that serves
 * static client assets, prerendered pages, and server-side rendered routes from
 * disk — the Node default.
 *
 * {@link makeHandlerWith} is the platform-neutral core: it takes an injected
 * {@link AssetSource} (where assets come from) and a `read` capability (how to
 * read server assets), so the same SvelteKit `HttpApp` can run on a Node server
 * or on Cloudflare Workers (assets from `env.ASSETS`).
 *
 * The returned app is an ordinary Effect value: it can be served with the
 * generated `build/index.js` entry (see `./serve.js`), mounted inside any
 * existing `effect/http` HTTP server, or converted to a `fetch` handler
 * (see {@link toWebHandler}).
 */

import type { Server as SvelteKitServer } from "@sveltejs/kit";
import * as FileSystem from "effect/FileSystem";
import * as HttpMethod from "effect/http/HttpMethod";
import * as HttpEffect from "effect/http/HttpEffect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Path from "effect/Path";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { AssetSource, type FileSystemAssetServices } from "./assets.js";

export { AssetFetchError, AssetSource, type FileSystemAssetServices } from "./assets.js";

/**
 * The services required by the SvelteKit HTTP application when serving assets
 * from the file system (the Node default). All of them are provided by
 * `NodeHttpServer.layer` from `@effect/platform-node`.
 */
export type SvelteKitHttpAppServices = FileSystemAssetServices;

/**
 * The SvelteKit application as a composable Effect HTTP handler: an effect that
 * produces an {@link HttpServerResponse.HttpServerResponse} for the current
 * request. The `HttpServerRequest` is supplied per request by the server. `R`
 * is the asset source's services (defaults to the file-system services).
 */
export type SvelteKitHttpApp<R = SvelteKitHttpAppServices> = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  R | HttpServerRequest.HttpServerRequest
>;

/** The SvelteKit build output {@link makeHandler} serves. */
export interface SvelteKitHandlerOptions {
  /** The SvelteKit `server` instance exported by the build output (`./server.js`). */
  readonly server: SvelteKitServer;
  /**
   * The application path, including any `paths.base` without its leading
   * slash (`"_app"`, or `"my-app/_app"` under a base), exported by the build
   * output (`./manifest.js`). Its `immutable/` subtree gets immutable cache
   * headers.
   */
  readonly appPath: string;
  /** The prerendered paths exported by the build output (`./manifest.js`'s `Set`, or any iterable). */
  readonly prerendered: Iterable<string>;
  /** The configured `paths.base`, exported by the build output (`./manifest.js`). */
  readonly base: string;
  /** Absolute path of the build output directory (contains `client/`, `server/`, `prerendered/`). */
  readonly dir: string;
  /** Environment variables passed to the SvelteKit server (e.g. `process.env`). */
  readonly env?: Record<string, string | undefined>;
  /** Prefix for the runtime configuration environment variables (ORIGIN, ...). */
  readonly envPrefix?: string;
}

/** Options for the platform-neutral SSR core, {@link makeHandlerWith}. */
export interface SvelteKitNeutralHandlerOptions<RAssets> {
  /** The SvelteKit `server` instance exported by the build output (`./server.js`). */
  readonly server: SvelteKitServer;
  /** Environment variables passed to the SvelteKit server. */
  readonly env?: Record<string, string | undefined> | undefined;
  /** Prefix for the runtime configuration environment variables (ORIGIN, ...). */
  readonly envPrefix?: string | undefined;
  /** Where static client assets and prerendered pages come from. */
  readonly assets: AssetSource<RAssets>;
  /**
   * How to read a server asset (backs `read()` from `$app/server`). On Node
   * this streams from `<dir>/server`; on Workers, back it with the platform's
   * own mechanism.
   */
  readonly read: (file: string) => ReadableStream<Uint8Array>;
}

/** Runtime configuration, read from the environment (compatible with adapter-node). */
const handlerConfig = (prefix: string) =>
  Config.all({
    origin: Config.option(Config.String(`${prefix}ORIGIN`)),
    protocolHeader: Config.option(Config.String(`${prefix}PROTOCOL_HEADER`)),
    hostHeader: Config.option(Config.String(`${prefix}HOST_HEADER`)),
    portHeader: Config.option(Config.String(`${prefix}PORT_HEADER`)),
    addressHeader: Config.option(Config.String(`${prefix}ADDRESS_HEADER`)),
    xffDepth: Config.Int(`${prefix}XFF_DEPTH`).pipe(Config.withDefault(1)),
  });

type HandlerConfig = Effect.Success<ReturnType<typeof handlerConfig>>;

/** Compute the request origin from configuration and headers (adapter-node semantics). */
const originOf = (request: HttpServerRequest.HttpServerRequest, config: HandlerConfig): string => {
  if (Option.isSome(config.origin)) return config.origin.value;

  const headers = request.headers;
  const protocolHeader = Option.getOrUndefined(config.protocolHeader)?.toLowerCase();
  const hostHeader = Option.getOrUndefined(config.hostHeader)?.toLowerCase() ?? "host";
  const portHeader = Option.getOrUndefined(config.portHeader)?.toLowerCase();

  const protocol = (protocolHeader && headers[protocolHeader]) || "http";
  const host = headers[hostHeader] ?? "localhost";
  const port = portHeader ? headers[portHeader] : undefined;

  return port ? `${protocol}://${host.split(":")[0]}:${port}` : `${protocol}://${host}`;
};

/** Resolve the client address, honouring ADDRESS_HEADER / XFF_DEPTH if configured. */
/**
 * The client address in an `X-Forwarded-For` value: the entry `xffDepth` hops
 * from the right, or the leftmost one when `xffDepth` is out of range.
 */
const forwardedForAddress = (value: string, xffDepth: number): string => {
  const addresses = value.split(",").map((address) => address.trim());
  const inRange = xffDepth >= 1 && xffDepth <= addresses.length;
  return addresses[inRange ? addresses.length - xffDepth : 0] ?? "";
};

const clientAddressOf = (
  request: HttpServerRequest.HttpServerRequest,
  config: HandlerConfig,
): string => {
  const addressHeader = Option.getOrUndefined(config.addressHeader)?.toLowerCase();
  const value = addressHeader === undefined ? undefined : request.headers[addressHeader];
  if (!value) return Option.getOrElse(request.remoteAddress, () => "");
  return addressHeader === "x-forwarded-for" ? forwardedForAddress(value, config.xffDepth) : value;
};

/** Build a web `Request` for SvelteKit from an `HttpServerRequest`. */
const toWebRequest = (
  request: HttpServerRequest.HttpServerRequest,
  url: URL,
  context: Context.Context<never>,
): Request => {
  // `Headers` is a redactable record-like value; copy the enumerable string
  // entries into a plain record for the web `Request` constructor.
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: { ...request.headers },
  };
  if (HttpMethod.hasBody(request.method)) {
    init.body = Stream.toReadableStreamWith(request.stream, context);
    init.duplex = "half";
  }
  return new Request(url, init);
};

/**
 * Creates the SvelteKit HTTP handler.
 *
 * The returned effect initialises the SvelteKit server (running your app's
 * server `init` hook) and yields an HTTP handler that:
 *
 * 1. serves static client assets from `<dir>/client` (with immutable cache
 *    headers for hashed build assets),
 * 2. serves prerendered pages from `<dir>/prerendered`,
 * 3. falls back to server-side rendering via the SvelteKit server.
 *
 * @example
 * ```ts
 * // Mounting SvelteKit inside an existing effect/http server:
 * import { handler } from "./build/handler.js";
 * import * as HttpServer from "effect/http/HttpServer";
 * import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
 * import { Effect, Layer } from "effect";
 * import { createServer } from "node:http";
 *
 * const serverLayer = Layer.unwrap(
 *   Effect.map(handler, (app) => HttpServer.serve(app))
 * ).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 })));
 *
 * NodeRuntime.runMain(Layer.launch(serverLayer));
 * ```
 */
export const makeHandler = (
  options: SvelteKitHandlerOptions,
): Effect.Effect<SvelteKitHttpApp, never, SvelteKitHttpAppServices> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const context = yield* Effect.context<never>();

    const serverDir = path.join(options.dir, "server");

    return yield* makeHandlerWith<SvelteKitHttpAppServices>({
      server: options.server,
      env: options.env,
      envPrefix: options.envPrefix,
      // `read` backs the `read()` helper from `$app/server`, streaming server
      // assets from the build output.
      read: (file) => Stream.toReadableStreamWith(fs.stream(path.join(serverDir, file)), context),
      assets: AssetSource.fileSystem({
        dir: options.dir,
        appPath: options.appPath,
        prerendered: options.prerendered,
      }),
    });
  });

/**
 * The SvelteKit server's `init` or `respond` rejected. SvelteKit turns a
 * route's own errors into responses, so a rejection is a bug in the server
 * build; the handler's error channel is `never`, so this reaches the platform
 * as a DEFECT (a 500), carrying what SvelteKit rejected with as `cause`.
 */
export class SvelteKitServerError extends Schema.TaggedError<SvelteKitServerError>()(
  "SvelteKitServerError",
  {
    /** Which `Server` method rejected. */
    operation: Schema.Literals(["init", "respond"]),
    /** What the method rejected with, or threw. */
    cause: Schema.Defect(),
  },
) {}

/**
 * The platform-neutral SSR core. Like {@link makeHandler}, but the asset source
 * and the server-asset `read` capability are injected, so the same SvelteKit
 * `HttpApp` can run on Node (file-system assets) or on Cloudflare Workers
 * (`AssetSource.cloudflareAssets(env.ASSETS)`).
 *
 * The returned app:
 *
 * 1. falls through to the injected {@link AssetSource} for static client assets
 *    and prerendered pages (GET/HEAD), then
 * 2. server-side renders via the SvelteKit server.
 *
 * @example
 * ```ts
 * // Workers: a fetch handler with assets from env.ASSETS
 * import { makeHandlerWith, AssetSource, toWebHandler } from "...adapter/handler";
 * import { server } from "./server.js";
 *
 * export default {
 *   fetch: (request, env, ctx) =>
 *     toWebHandler(
 *       makeHandlerWith({
 *         server, env,
 *         assets: AssetSource.cloudflareAssets(env.ASSETS),
 *         read: () => { throw new Error("read() not supported on this deployment"); },
 *       }),
 *     )(request),
 * };
 * ```
 */
export const makeHandlerWith = <RAssets = never>(
  options: SvelteKitNeutralHandlerOptions<RAssets>,
): Effect.Effect<SvelteKitHttpApp<RAssets>, never, never> =>
  Effect.gen(function* () {
    const config = yield* handlerConfig(options.envPrefix ?? "").pipe(Effect.orDie);

    // Initialise the SvelteKit server. `read` backs `read()` from `$app/server`.
    const server = options.server;
    yield* Effect.tryPromise({
      try: () =>
        server.init({
          env: options.env ?? {},
          read: options.read,
        }),
      catch: (cause) => new SvelteKitServerError({ operation: "init", cause }),
    }).pipe(Effect.orDie);

    // The HTTP handler itself, evaluated once per request.
    return Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const requestContext = yield* Effect.context<never>();

      const origin = originOf(request, config);
      const url = new URL(request.url, origin);

      // A malformed percent-encoding (`decodeURIComponent` throws) is a 400.
      const decoded = Result.try(() => decodeURIComponent(url.pathname));
      if (Result.isFailure(decoded)) return HttpServerResponse.empty({ status: 400 });
      const pathname = decoded.success;

      // 1. Static client assets / prerendered pages, via the injected source.
      //    Only GET/HEAD reach assets; build a body-less request for the source.
      if (request.method === "GET" || request.method === "HEAD") {
        const assetRequest = new Request(url, {
          method: request.method,
          headers: { ...request.headers },
        });
        const asset = yield* options.assets.serveAsset(assetRequest, pathname);
        if (Option.isSome(asset)) return asset.value;
      }

      // 2. Server-side rendering.
      const webRequest = toWebRequest(request, url, requestContext);
      const response = yield* Effect.tryPromise({
        try: () =>
          server.respond(webRequest, {
            getClientAddress: () => clientAddressOf(request, config),
          }),
        catch: (cause) => new SvelteKitServerError({ operation: "respond", cause }),
      }).pipe(Effect.orDie);
      return HttpServerResponse.fromWeb(response);
    });
  });

/**
 * Convert a SvelteKit `HttpApp` to a Web `fetch` handler, providing the asset
 * source's services with `layer`. Use this for a Workers `fetch` export or any
 * runtime that speaks the Web platform.
 *
 * @example
 * ```ts
 * const fetchHandler = toWebHandler(
 *   makeHandlerWith({ ..., assets: AssetSource.cloudflareAssets(env.ASSETS) }),
 *   Layer.empty,
 * );
 * ```
 */
export const toWebHandler = <RAssets, E>(
  app: Effect.Effect<SvelteKitHttpApp<RAssets>, never, never>,
  layer: Layer.Layer<RAssets, E>,
): ((request: Request) => Promise<Response>) => {
  // Build the app (server.init) and the per-request web handler once, lazily on
  // the first request, then dispatch each request through it.
  let built: Promise<(request: Request) => Promise<Response>> | undefined;
  const build = (): Promise<(request: Request) => Promise<Response>> =>
    (built ??= Effect.runPromise(app).then(
      (inner) =>
        // SAFETY: `layer` provides `RAssets`, and the web handler provides the
        // `HttpServerRequest`, so the handler needs no per-request context; the
        // conditional type only stays unresolved while `RAssets` is generic.
        HttpEffect.toWebHandlerLayer(inner, layer).handler as (
          request: Request,
        ) => Promise<Response>,
    ));
  return async (request) => (await build())(request);
};
