---
"@thomasfosterau/effect-sveltekit": minor
---

Add explicit Effect wrappers for the remaining SvelteKit hooks, so the explicit
API now covers the same hooks as the `effectKit()` auto-wrap path.

- `/server`: `handleFetch`, `handleError`, and `init` join the existing `handle`
  helper. They run on the SvelteKit server runtime (per-request `HttpClient` +
  `RequestEvent`), and the matching `ServerRuntime` methods
  (`handleFetch`/`handleError`/`init`) make them available with an app-wide
  layer's services.
- `/client`: `handleError` and `init` wrap the client-side `hooks.client.ts`
  hooks, running each Effect on a bare runtime.
