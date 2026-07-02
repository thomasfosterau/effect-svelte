---
"@thomasfosterau/effect-svelte": minor
---

Add a Svelte 5 async bridge and debounced reactive queries: `useQueryPromise(effect)` exposes a `promise` for `{#await}` / `<svelte:boundary>`, and `useDerived` gains a `{ debounce }` option to coalesce rapid dependency changes (e.g. debounced search) (#50).
