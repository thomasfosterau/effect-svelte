/**
 * Runtime handler for the Effect SvelteKit adapter.
 *
 * `makeHandler` turns a built SvelteKit app (the `Server` class and manifest
 * emitted by `vite build`) into an `@effect/platform` `HttpApp` that serves
 * static client assets, prerendered pages, and server-side rendered routes.
 *
 * The returned app is an ordinary Effect value: it can be served with the
 * generated `build/index.js` entry (see `./serve.js`), or mounted inside any
 * existing `@effect/platform` HTTP server alongside other routes.
 */

import type { SSRManifest, Server as SvelteKitServer } from "@sveltejs/kit";
import * as FileSystem from "@effect/platform/FileSystem";
import * as HttpApp from "@effect/platform/HttpApp";
import * as HttpMethod from "@effect/platform/HttpMethod";
import * as HttpPlatform from "@effect/platform/HttpPlatform";
import * as HttpServerRequest from "@effect/platform/HttpServerRequest";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import * as Path from "@effect/platform/Path";
import { Config, Effect, Option, Runtime, Stream } from "effect";

/**
 * The services required by the SvelteKit HttpApp. All of them are provided
 * by `NodeHttpServer.layer` / `NodeContext.layer` from `@effect/platform-node`.
 */
export type SvelteKitHttpAppServices =
  | FileSystem.FileSystem
  | Path.Path
  | HttpPlatform.HttpPlatform;

/**
 * The SvelteKit application as a composable `@effect/platform` HttpApp.
 */
export type SvelteKitHttpApp = HttpApp.Default<never, SvelteKitHttpAppServices>;

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

/** Runtime configuration, read from the environment (compatible with adapter-node). */
const handlerConfig = (prefix: string) =>
  Config.all({
    origin: Config.option(Config.string(`${prefix}ORIGIN`)),
    protocolHeader: Config.option(Config.string(`${prefix}PROTOCOL_HEADER`)),
    hostHeader: Config.option(Config.string(`${prefix}HOST_HEADER`)),
    portHeader: Config.option(Config.string(`${prefix}PORT_HEADER`)),
    addressHeader: Config.option(Config.string(`${prefix}ADDRESS_HEADER`)),
    xffDepth: Config.integer(`${prefix}XFF_DEPTH`).pipe(Config.withDefault(1)),
  });

type HandlerConfig = Effect.Effect.Success<ReturnType<typeof handlerConfig>>;

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
  runtime: Runtime.Runtime<never>,
): Request => {
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: request.headers,
  };
  if (HttpMethod.hasBody(request.method)) {
    init.body = Stream.toReadableStreamRuntime(request.stream, runtime);
    init.duplex = "half";
  }
  return new Request(url, init);
};

const IMMUTABLE_HEADERS = { "cache-control": "public, max-age=31536000, immutable" };

/**
 * Creates the SvelteKit HttpApp.
 *
 * The returned effect initialises the SvelteKit server (running your app's
 * server `init` hook) and yields an HttpApp that:
 *
 * 1. serves static client assets from `<dir>/client` (with immutable cache
 *    headers for hashed build assets),
 * 2. serves prerendered pages from `<dir>/prerendered`,
 * 3. falls back to server-side rendering via the SvelteKit server.
 *
 * @example
 * ```ts
 * // Mounting SvelteKit inside an existing @effect/platform server:
 * import { handler } from "./build/handler.js";
 * import { HttpServer } from "@effect/platform";
 * import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
 * import { Effect, Layer } from "effect";
 * import { createServer } from "node:http";
 *
 * const serverLayer = Layer.unwrapEffect(
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
    const config = yield* handlerConfig(options.envPrefix ?? "").pipe(Effect.orDie);
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const runtime = yield* Effect.runtime<never>();

    const clientDir = path.join(options.dir, "client");
    const prerenderedDir = path.join(options.dir, "prerendered");
    const serverDir = path.join(options.dir, "server");

    // Initialise the SvelteKit server. `read` backs the `read()` helper from
    // `$app/server`, streaming server assets from the build output.
    const server = new options.Server(options.manifest);
    yield* Effect.promise(() =>
      server.init({
        env: (options.env ?? {}) as Record<string, string>,
        read: (file) =>
          Stream.toReadableStreamRuntime(fs.stream(path.join(serverDir, file)), runtime),
      }),
    );

    /**
     * Serve a file from `root` if `pathname` resolves to an existing file
     * inside it. Returns `Option.none()` when the file does not exist or the
     * path escapes `root`.
     */
    const serveFile = (
      root: string,
      pathname: string,
      headers?: Record<string, string>,
    ): Effect.Effect<
      Option.Option<HttpServerResponse.HttpServerResponse>,
      never,
      SvelteKitHttpAppServices
    > =>
      Effect.gen(function* () {
        const filePath = path.join(root, pathname);

        // Prevent path traversal outside of the served directory.
        const relative = path.relative(root, filePath);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          return Option.none();
        }

        const stat = yield* fs.stat(filePath).pipe(Effect.option);
        if (Option.isNone(stat) || stat.value.type !== "File") {
          return Option.none();
        }

        const response = yield* HttpServerResponse.file(filePath, { headers }).pipe(Effect.orDie);
        return Option.some(response);
      });

    /** Serve a prerendered page, trying the file layouts SvelteKit emits. */
    const servePrerendered = (
      pathname: string,
    ): Effect.Effect<
      Option.Option<HttpServerResponse.HttpServerResponse>,
      never,
      SvelteKitHttpAppServices
    > => {
      const candidates =
        pathname === "/"
          ? ["/index.html"]
          : pathname.endsWith("/")
            ? [`${pathname}index.html`, `${pathname.slice(0, -1)}.html`]
            : [pathname, `${pathname}.html`, `${pathname}/index.html`];

      return Effect.reduce(
        candidates,
        Option.none<HttpServerResponse.HttpServerResponse>(),
        (found, candidate) =>
          Option.isSome(found) ? Effect.succeed(found) : serveFile(prerenderedDir, candidate),
      );
    };

    const immutablePrefix = `/${options.manifest.appPath}/immutable/`;

    // The HttpApp itself, evaluated once per request.
    return Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const requestRuntime = yield* Effect.runtime<never>();

      const origin = originOf(request, config);
      const url = new URL(request.url, origin);

      let pathname: string;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return HttpServerResponse.empty({ status: 400 });
      }

      // 1. Static client assets (hashed build assets get immutable caching).
      if (request.method === "GET" || request.method === "HEAD") {
        const isImmutable = pathname.startsWith(immutablePrefix);
        const asset = yield* serveFile(
          clientDir,
          pathname,
          isImmutable ? IMMUTABLE_HEADERS : undefined,
        );
        if (Option.isSome(asset)) return asset.value;

        // 2. Prerendered pages.
        if (options.prerendered.has(pathname) || options.prerendered.has(pathname + "/")) {
          const page = yield* servePrerendered(pathname);
          if (Option.isSome(page)) return page.value;
        }
      }

      // 3. Server-side rendering.
      const webRequest = toWebRequest(request, url, requestRuntime);
      const response = yield* Effect.promise(() =>
        server.respond(webRequest, {
          getClientAddress: () => clientAddressOf(request, config),
        }),
      );
      return HttpServerResponse.fromWeb(response);
    });
  });
