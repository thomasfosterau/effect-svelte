---
"@thomasfosterau/effect-sveltekit": minor
---

Add `SvelteKitCookies`, `SvelteKitResponseHeaders`, and `SvelteKitLocals` as tagged Effect services (#47).

All three are provided automatically as part of `SvelteKitServices` in every server handler effect — no extra setup required. Each can be replaced with a `Layer.succeed` stub in unit tests without needing a real `RequestEvent`.

- `yield* SvelteKitCookies` — Effect-wrapped cookies API (`get`, `getAll`, `set`, `delete`, `serialize`)
- `yield* SvelteKitResponseHeaders` — Effect-wrapped `event.setHeaders` (`set`)
- `yield* SvelteKitLocals` — the live `App.Locals` reference for the current request
- `requestServicesLayer` — merges all three `.layer` statics; exported for custom runtime setups
