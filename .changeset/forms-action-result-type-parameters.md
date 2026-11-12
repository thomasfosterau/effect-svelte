---
"@thomasfosterau/effect-sveltekit": minor
---

`Forms.applyAction` and `Forms.deserialize` now have exactly the type parameters of the `$app/forms` functions they wrap: `Success` and `Failure` no longer default to `Record<string, unknown>`.

- `Forms.deserialize<Success>(body)` with one type argument no longer compiles: pass both (`Forms.deserialize<Success, Failure>(body)`) or neither.
- `Forms.deserialize(body)` with no type arguments, where nothing else fixes the result type, now succeeds with `ActionResult<Record<string, unknown> | undefined, Record<string, unknown> | undefined>`, as `$app/forms`' `deserialize` returns. `data` was already optional on a `success` / `failure` result, so reading it is unchanged.
- `Forms.applyAction(result)` infers both from `result` as before.

`Forms.enhance` is unchanged for callers; its parameter type now names the handlers present with a `Pick` of the handlers type instead of a record of `unknown`.
