---
"@thomasfosterau/effect-svelte": patch
"@thomasfosterau/effect-sveltekit": patch
---

README shortened to what the package is, install, one example, the entry-point table and links; the reference moved to the repository's `docs/` pages, which the README links to with absolute URLs. TSDoc additions: `RuntimeContext.get` names the `RuntimeNotFoundError` it throws; `ServerRuntime.handle` describes the per-request runtime it creates; `Forms.enhance` says `onError` runs on the same runtime and must not fail; `Endpoint.fromApi` says when its layer is built and disposed; `effectAdapter` states the production server's Node `>=22.19` requirement; and the `makeHandlerWith` example passes `toWebHandler` its layer.
