---
"@thomasfosterau/effect-svelte": major
---

Merge `@thomasfosterau/effect-svelte` and `@thomasfosterau/effect-svelte-kit` into a single package.

- Svelte 5 runes integration remains at the package root: `@thomasfosterau/effect-svelte`.
- SvelteKit helpers are now exposed as subpath exports:
  - `@thomasfosterau/effect-svelte/kit` - Universal helpers
  - `@thomasfosterau/effect-svelte/kit/server` - Server-only helpers
  - `@thomasfosterau/effect-svelte/kit/client` - Client-only helpers
  - `@thomasfosterau/effect-svelte/kit/vite` - The `effectKit()` Vite plugin
- `@thomasfosterau/effect-svelte-kit` will not be published; install `@thomasfosterau/effect-svelte` instead.
- The SvelteKit peer dependencies (`@sveltejs/kit`, `@effect/platform`, `vite`) are optional; they are only required when importing from the `/kit` subpaths.

The repository is now managed by Vite+ (`vite-plus`): builds via `vp pack` (tsdown), tests via `vp test` (Vitest), linting/formatting/type checks via `vp check` (Oxlint, Oxfmt, tsgolint).
