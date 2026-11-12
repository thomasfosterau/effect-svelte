---
"@thomasfosterau/effect-sveltekit": minor
---

**Breaking (types only):** the adapter handler, the `$env` config helpers and
the `effectKit()` auto-wrappers no longer spell `T | undefined` / `T | null`
by hand (#213). Runtime behaviour is unchanged. Each changed export, and the
one-line migration:

- `SvelteKitNeutralHandlerOptions.env` and `.envPrefix` (the options of
  `makeHandlerWith`, `./adapter/handler`) are declared `readonly env?: …` /
  `readonly envPrefix?: string` rather than `?: … | undefined`. With
  `exactOptionalPropertyTypes` on, passing an explicit `undefined`
  (`makeHandlerWith({ …, envPrefix: undefined })`) is now a type error: omit
  the key instead. An omitted `env` is still an empty map and an omitted
  `envPrefix` still no prefix.
- The environment map the adapter and the config helpers take
  (`SvelteKitHandlerOptions.env`, `SvelteKitNeutralHandlerOptions.env`,
  `sveltekitConfigProvider`, `sveltekitConfig`, `readConfig`) is typed as
  SvelteKit's own `ServerInitOptions["env"]` instead of a restated
  `Record<string, string | undefined>`. It is the same shape today, so
  `process.env`, the `$env/*` modules and a Workers `env` are accepted as
  before: nothing to change.
- `@thomasfosterau/effect-sveltekit/internal/auto` (called only by the code
  `effectKit()` generates): `wrapLoad`, `wrapServerLoad`, `wrapAction`,
  `wrapActions`, `wrapHandle`, `wrapHandleFetch`, `wrapHandleError`,
  `wrapEndpoint`, `wrapReroute` and `wrapInit` are now overloaded instead of
  generic over `T extends undefined | …`: given an Effect or a function they
  return the SvelteKit export, and given `undefined` they return `undefined`.
  Generated code is unaffected. A hand-written call that passes a value typed
  `X | undefined` no longer matches either overload: branch on `undefined`
  first, or use the explicit wrappers (`serverLoad`, `actions`, `handle`, …).
