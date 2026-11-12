---
"@thomasfosterau/effect-sveltekit": minor
---

**Breaking (build time):** `effectAdapter()`'s `adapt` hook now writes the
build with Effect's `FileSystem` service instead of `node:fs` (#213), on
Node's file system from `@effect/platform-node`. The files it writes and the
code it generates are unchanged.

- `@thomasfosterau/effect-sveltekit/adapter` now imports
  `@effect/platform-node` (still an optional peer), so it must be installed to
  build with the adapter. The `"node"` target already needed it to run the
  server; a `target: "fetch"` app that had not installed it must add it
  (`pnpm add -D @effect/platform-node`, on the same version as `effect`).
- A file operation that fails rejects `adapt`'s promise with Effect's
  `PlatformError` rather than Node's `fs` error. What SvelteKit's builder
  throws, or `builder.compress` rejects with, still rejects with that value.
