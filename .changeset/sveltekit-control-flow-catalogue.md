---
"@thomasfosterau/effect-sveltekit": minor
---

Add Effect-native SvelteKit control-flow error catalogue and default translator (#42).

**New exports from `@thomasfosterau/effect-sveltekit/server`:**

- `SvelteKit.redirect(status, location)` — yield a typed redirect failure instead of throwing
- `SvelteKit.error(status, body?)` — yield a typed HTTP error failure
- `SvelteKit.fail(status, data)` — yield a typed form-action failure
- `SvelteKit.translate` — the turnkey `ErrorTranslator` that maps the above to `redirect()` / `error()` / `fail()` at the request boundary
- `SvelteKit.makeTranslator([...cases])` — compose `translate` with your own domain-error matchers (consumer cases run first)
- `KitRedirect`, `KitError`, `KitActionFailure` — the exported tagged error classes (use with `Effect.catchTag`, `instanceof`, etc.)
- `KitTranslatorCase`, `KitErrorTranslator` — companion types

**Breaking (minor):** `SvelteKit.translate` is now the default `translateError` for `makeRuntimeAdapter`, `makeServerRuntime`, and `RemoteFunction.withRuntime`. The previous default was the "passthrough" translator (`causeToThrowable`) which converted any non-SvelteKit error to an `EffectCauseError`. The new default adds handling for `KitRedirect` / `KitError` / `KitActionFailure` before falling back to the same passthrough. Existing code that does not produce these new error types is unaffected.
