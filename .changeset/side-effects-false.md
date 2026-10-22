---
"@thomasfosterau/effect-svelte": patch
"@thomasfosterau/effect-sveltekit": patch
---

Declare `"sideEffects": false`, so a bundler drops the modules a consumer's imports do not reach. A universal `src/hooks.ts` that imports only `ResponseHeaders` from `@thomasfosterau/effect-sveltekit` now adds `response-headers.js` and `transport.js` to the client entry instead of the whole root entry (the default runtime, `HttpClient`, `Stream` and the remote-function helpers). Every published module only declares at load; a test in each package guards both that and the tree-shaking. Reaching a member through a namespace export (`Hooks.responseHeadersTransporter`, `Remote.*`, …) still keeps every module that namespace reaches; #191 tracks that.
