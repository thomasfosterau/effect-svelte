/**
 * Pluggable asset serving for the Effect SvelteKit adapter.
 *
 * The SSR core ({@link makeHandler}) is platform-neutral: it falls through to an
 * injected {@link AssetSource} for static client assets and prerendered pages,
 * rather than reading the file system directly. This lets the same SvelteKit
 * `HttpApp` run on a Node server (assets from disk) or on Cloudflare Workers
 * (assets from the `env.ASSETS` binding, or any custom source — R2, KV, a CDN
 * passthrough).
 *
 * Ship several sources as equals and let the adapter (or the caller) pick:
 *
 * - {@link fileSystem} — serve `client/` + `prerendered/` from disk (Node
 *   default). Requires `FileSystem` / `Path` / `HttpPlatform`.
 * - {@link cloudflareAssets} — serve from a Workers static-assets binding
 *   (`env.ASSETS`). Requires nothing.
 */

import { Effect, Option } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as HttpPlatform from "effect/unstable/http/HttpPlatform";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

/**
 * A source of static assets. `serveAsset` returns the response for an asset
 * request, or `Option.none()` when the request is not an asset (so the SSR core
 * continues to server-side rendering). `R` is the set of services the source
 * needs (e.g. `FileSystem | Path | HttpPlatform` for {@link fileSystem}, or
 * `never` for {@link cloudflareAssets}).
 */
export interface AssetSource<R = never> {
  readonly serveAsset: (
    request: Request,
    pathname: string,
  ) => Effect.Effect<Option.Option<HttpServerResponse.HttpServerResponse>, never, R>;
}

/** The services a file-system {@link AssetSource} requires. */
export type FileSystemAssetServices = FileSystem.FileSystem | Path.Path | HttpPlatform.HttpPlatform;

const IMMUTABLE_HEADERS = { "cache-control": "public, max-age=31536000, immutable" };

/**
 * Serve static client assets and prerendered pages from a build directory on
 * disk (the Node default). `dir` contains `client/` and `prerendered/`.
 */
export const fileSystem = (config: {
  /** Absolute path of the build output directory (contains `client/`, `prerendered/`). */
  readonly dir: string;
  /** The configured `manifest.appPath` — its `immutable/` subtree gets immutable caching. */
  readonly appPath: string;
  /** The set of prerendered paths exported by the build output. */
  readonly prerendered: ReadonlySet<string>;
}): AssetSource<FileSystemAssetServices> => ({
  serveAsset: (request, pathname) =>
    Effect.gen(function* () {
      // Only GET/HEAD reach static assets.
      if (request.method !== "GET" && request.method !== "HEAD") return Option.none();

      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;

      const clientDir = path.join(config.dir, "client");
      const prerenderedDir = path.join(config.dir, "prerendered");
      const immutablePrefix = `/${config.appPath}/immutable/`;

      /**
       * Serve a file from `root` if `pathname` resolves to an existing file
       * inside it (rejecting path traversal). `Option.none()` otherwise.
       */
      const serveFile = (
        root: string,
        candidate: string,
        headers?: Record<string, string>,
      ): Effect.Effect<
        Option.Option<HttpServerResponse.HttpServerResponse>,
        never,
        FileSystemAssetServices
      > =>
        Effect.gen(function* () {
          const filePath = path.join(root, candidate);
          const relative = path.relative(root, filePath);
          if (relative.startsWith("..") || path.isAbsolute(relative)) return Option.none();

          const stat = yield* fs.stat(filePath).pipe(Effect.option);
          if (Option.isNone(stat) || stat.value.type !== "File") return Option.none();

          const response = yield* HttpServerResponse.file(filePath, { headers }).pipe(Effect.orDie);
          return Option.some(response);
        });

      // 1. Static client assets (hashed build assets get immutable caching).
      const isImmutable = pathname.startsWith(immutablePrefix);
      const asset = yield* serveFile(
        clientDir,
        pathname,
        isImmutable ? IMMUTABLE_HEADERS : undefined,
      );
      if (Option.isSome(asset)) return asset;

      // 2. Prerendered pages.
      if (config.prerendered.has(pathname) || config.prerendered.has(pathname + "/")) {
        const candidates =
          pathname === "/"
            ? ["/index.html"]
            : pathname.endsWith("/")
              ? [`${pathname}index.html`, `${pathname.slice(0, -1)}.html`]
              : [pathname, `${pathname}.html`, `${pathname}/index.html`];
        for (const candidate of candidates) {
          const page = yield* serveFile(prerenderedDir, candidate);
          if (Option.isSome(page)) return page;
        }
      }

      return Option.none();
    }),
});

/**
 * Serve static assets from a Cloudflare Workers static-assets binding (commonly
 * `env.ASSETS`). The binding's `fetch` resolves client assets and prerendered
 * pages uploaded by the deployment; a 404 from it means "not an asset", so the
 * SSR core continues to server-side rendering.
 *
 * This is one provided convenience, not the assumption: pass any object with a
 * `fetch` (R2, KV, a CDN passthrough) or a custom {@link AssetSource}.
 */
export const cloudflareAssets = (assets: {
  fetch: (request: Request) => Promise<Response> | Response;
}): AssetSource => ({
  serveAsset: (request) =>
    Effect.gen(function* () {
      if (request.method !== "GET" && request.method !== "HEAD") return Option.none();
      const response = yield* Effect.promise(async () => assets.fetch(request));
      if (response.status === 404) return Option.none();
      return Option.some(HttpServerResponse.fromWeb(response));
    }),
});

/** The {@link AssetSource} constructors, grouped for the adapter API. */
export const AssetSource = {
  fileSystem,
  cloudflareAssets,
};
