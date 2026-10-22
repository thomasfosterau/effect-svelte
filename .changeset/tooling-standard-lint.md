---
"@thomasfosterau/effect-svelte": patch
"@thomasfosterau/effect-sveltekit": patch
---

Internal cleanup from adopting the Effect lint preset, with no change to the public API:

- `dist/` imports Effect modules by path (`effect/Effect`, `effect/Layer`, …) instead of from the `effect` barrel.
- Type assertions that remain carry a documented invariant, and loops, `typeof` checks and `try` / `catch` blocks are rewritten with `effect/Array`, `effect/Record`, `effect/Predicate` and `Result`, preserving behaviour.
- `effect-sveltekit`: query-string and form-data objects built by the request parsers now keep a `__proto__` key as an own property rather than dropping it; `causeToThrowable`'s return type is narrowed to `Redirect | HttpError | EffectCauseError`.
- Package `homepage` links point at the `trunk` branch.
