---
"@thomasfosterau/effect-sveltekit": minor
---

The deployment adapter now produces a platform-neutral Effect `HttpApp` with
pluggable asset serving, so the same SvelteKit app can run on a Node HTTP server
or as a Cloudflare Workers `fetch` handler.

- `makeHandlerWith(options)` is the platform-neutral SSR core: it takes an
  injected `AssetSource` (where static assets come from) and a `read` capability
  (how to read server assets), instead of reading the file system directly.
  `makeHandler` is unchanged — it's now `makeHandlerWith` wired to
  `AssetSource.fileSystem` and a FileSystem-backed `read` (the Node default).
- `AssetSource` ships several sources as equals: `AssetSource.fileSystem(...)`
  (Node, requires `FileSystem` / `Path` / `HttpPlatform`),
  `AssetSource.cloudflareAssets(env.ASSETS)` (Workers, requires nothing), or any
  custom `AssetSource` (R2, KV, a CDN passthrough). A source returns
  `Option.none()` for non-assets so the SSR core continues to render.
- `toWebHandler(app, layer)` converts a SvelteKit `HttpApp` to a Web `fetch`
  handler (via `HttpEffect.toWebHandlerLayer`), for a Workers `fetch` export or
  any Web-platform runtime.
- `effectAdapter({ target: "fetch" })` emits a Cloudflare Workers entry
  (`build/index.js` exporting `default { fetch }`) that serves assets from the
  `ASSETS` binding; `target: "node"` (default) keeps the Node server entry. Both
  targets still write `build/handler.js` (the `HttpApp`). The `fetch` target
  reports `read()` from `$app/server` as unsupported.

Backward compatible: `makeHandler`, the Node `serve`, and the default adapter
behaviour are unchanged.
