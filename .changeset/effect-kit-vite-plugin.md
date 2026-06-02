---
"@thomasfosterau/effect-svelte": minor
---

Add `effectKit()` Vite plugin at `@thomasfosterau/effect-svelte/kit/vite`.

The plugin rewrites the standard SvelteKit route exports (`load`, `actions`,
`handle`, `handleFetch`, `handleError`, `init`, and HTTP method handlers in
`+server.ts`) so users can return an Effect, or a function returning an
Effect, directly without manually wrapping with `serverLoad`/`action`/etc.
Internally the generated code calls the same runtime as the explicit
wrappers, so behaviour is identical. Plain promise/value-returning functions
are not affected, making the plugin safe to enable on existing projects.

Existing explicit wrappers (`load`, `serverLoad`, `action`, `actions`,
`handle`, `endpoint`, ...) continue to be exported and supported.

New dependencies: `magic-string` (runtime), `vite` (optional peer, `^5 || ^6 || ^7 || ^8`).
