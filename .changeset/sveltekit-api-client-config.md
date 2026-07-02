---
"@thomasfosterau/effect-sveltekit": minor
---

Add `apiClient(api, options?)` — a typed client for an `Endpoint.fromApi`, wrapping Effect's `HttpApiClient.make` with `FetchHttpClient` provided (pass `event.fetch` in a `load` for SSR fetch). Add `readConfig(env, config)` — read a typed Effect `Config` from a SvelteKit `$env` record in one call. Promotes the two remaining #51 items from cookbook recipes to real APIs.
