/**
 * Runtime handler for the Effect SvelteKit adapter.
 *
 * `makeHandler` turns a built SvelteKit app (the `Server` class and manifest
 * emitted by `vite build`) into an Effect HTTP application that serves
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

import type { SSRManifest, Server as SvelteKitServer } from "@sveltejs/kit";
import * as FileSystem from "effect/FileSystem";
import * as HttpMethod from "effect/http/HttpMethod";
import * as HttpEffect from "effect/http/HttpEffect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Path from "effect/Path";
import { Config, Context, Effect, Layer, Option, Stream } from "effect";
import { AssetSource, type FileSystemAssetServices } from "./assets.js";

export { AssetSource, type FileSystemAssetServices } from "./assets.js";

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

export interface SvelteKitHandlerOptions {
  /** The SvelteKit `Server` class exported by the build output (`./server/index.js`). */
  readonly Server: typeof SvelteKitServer;
  /** The SSR manifest exported by the build output (`./manifest.js`). */
  readonly manifest: SSRManifest;
  /** The set of prerendered paths exported by the build output (`./manifest.js`). */
  readonly prerendered: ReadonlySet<string>;
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
  /** The SvelteKit `Server` class exported by the build output. */
  readonly Server: typeof SvelteKitServer;
  /** The SSR manifest exported by the build output. */
  readonly manifest: SSRManifest;
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
const clientAddressOf = (
  request: HttpServerRequest.HttpServerRequest,
  config: HandlerConfig,
): string => {
  const addressHeader = Option.getOrUndefined(config.addressHeader)?.toLowerCase();
  if (addressHeader) {
    const value = request.headers[addressHeader];
    if (value) {
      if (addressHeader === "x-forwarded-for") {
        const addresses = value.split(",").map((address) => address.trim());
        if (config.xffDepth < 1 || config.xffDepth > addresses.length) {
          return addresses[0] ?? "";
        }
        return addresses[addresses.length - config.xffDepth]!;
      }
      return value;
    }
  }
  return Option.getOrElse(request.remoteAddress, () => "");
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
      Server: options.Server,
      manifest: options.manifest,
      env: options.env,
      envPrefix: options.envPrefix,
      // `read` backs the `read()` helper from `$app/server`, streaming server
      // assets from the build output.
      read: (file) => Stream.toReadableStreamWith(fs.stream(path.join(serverDir, file)), context),
      assets: AssetSource.fileSystem({
        dir: options.dir,
        appPath: options.manifest.appPath,
        prerendered: options.prerendered,
      }),
    });
  });

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
 * import { Server } from "./server/index.js";
 * import { manifest } from "./manifest.js";
 *
 * export default {
 *   fetch: (request, env, ctx) =>
 *     toWebHandler(
 *       makeHandlerWith({
 *         Server, manifest, env,
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
    const server = new options.Server(options.manifest);
    yield* Effect.promise(() =>
      server.init({
        env: (options.env ?? {}) as Record<string, string>,
        read: options.read,
      }),
    );

    // The HTTP handler itself, evaluated once per request.
    return Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const requestContext = yield* Effect.context<never>();

      const origin = originOf(request, config);
      const url = new URL(request.url, origin);

      let pathname: string;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return HttpServerResponse.empty({ status: 400 });
      }

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
      const response = yield* Effect.promise(() =>
        server.respond(webRequest, {
          getClientAddress: () => clientAddressOf(request, config),
        }),
      );
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
        HttpEffect.toWebHandlerLayer(inner, layer).handler as (
          request: Request,
        ) => Promise<Response>,
    ));
  return async (request) => (await build())(request);
};
