---
"@thomasfosterau/effect-sveltekit": minor
---

`Forms.enhance` (in `./client`) calls `onSubmit`, `onResult` and `onError` as methods of the handlers object, so `this` in a handler written as a method is that object. 0.5.0 did so for `onSubmit` only (it called `onResult` detached and had no `onError`).
