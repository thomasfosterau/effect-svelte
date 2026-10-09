---
"@thomasfosterau/effect-sveltekit": patch
---

`Forms.enhance` (in `./client`) now requires its `{ runtime }` option, typed to provide every service the handlers require, whenever `onSubmit`, `onResult` or `onError` requires a service. Before, such a call type-checked without a runtime and the handler died with a missing-service defect when it ran; it is now a type error. This is a type-only change: calls whose handlers require no services keep the options optional, calls that already pass a runtime providing those services are unchanged, and the code it rejects is code that dies with a missing-service defect once a handler reaches the service it requires (or that passes an options object whose type leaves `runtime` optional). `onSubmit` and `onResult` (and `runtime`) are now declared `?: … | undefined`, so a handler or runtime forwarded as `undefined` (for example by spreading `{ onResult: undefined }`) type-checks under `exactOptionalPropertyTypes`.
