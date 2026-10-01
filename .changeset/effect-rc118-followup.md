---
"@thomasfosterau/effect-svelte": patch
"@thomasfosterau/effect-sveltekit": patch
---

Document behaviour inherited from Effect rc.118. `ConfigProvider.fromEnv` treats an empty string as a missing value, so `sveltekitConfigProvider`, `sveltekitConfig`, `readConfig` and the adapter's `*_ORIGIN`, `*_XFF_DEPTH`, `*_HOST` and `*_PORT` variables now fail (`Config.String`), take their `withDefault` (including `Config.Int`, which used to fail) or become `None` (`Config.option`) on `""`; tests now pin this. The Atom runtime memo map is now per registry, so layers are no longer shared across separate atom registries. The install docs now say `effect@rc` and `@effect/platform-node@rc`, and a `Stream.scan` JSDoc example uses the lazy seed.
