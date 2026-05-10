---
"@thomasfosterau/effect-svelte": major
"@thomasfosterau/effect-svelte-kit": major
---

Split the project into two packages with independent entrypoints.

- Keep Svelte runtime and runes integrations in @thomasfosterau/effect-svelte.
- Move SvelteKit helpers to @thomasfosterau/effect-svelte-kit.
- Replace legacy /kit subpath imports with the new package imports.

This release is intentionally breaking and does not provide temporary compatibility aliases.
