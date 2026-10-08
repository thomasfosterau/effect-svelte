---
"@thomasfosterau/effect-sveltekit": minor
---

`Remote.callQuery`, `Remote.callCommand`, `Remote.callCommandWithUpdates`, `Remote.callPrerender`, `Remote.submitForm` and `Remote.submitFormWithUpdates` now fail on the Effect error channel when the remote call rejects (or the remote function throws synchronously), with the original rejection reason (`unknown`, including a SvelteKit `HttpError` / `Redirect`). Previously the rejection became a defect despite the declared `unknown` error type, so `Effect.catch` never saw it. Code that recovered from a rejected remote call with `Effect.catchCause` / `Effect.catchDefect` should now handle it as a failure (for example with `Effect.catch`); the SvelteKit boundaries in this package still rethrow a `Redirect` / `HttpError` whether it arrives as a failure or a defect.
