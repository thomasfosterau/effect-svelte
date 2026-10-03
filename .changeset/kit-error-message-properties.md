---
"@thomasfosterau/effect-sveltekit": patch
---

`SvelteKit.translate` and `Errors.toSvelteKit` no longer call SvelteKit 3's deprecated `error(status, body)` overload, so they stop triggering Kit's `error_body_deprecated` warning in development. An object body (a `KitError` body, or an `App.Error` returned by a catalogue entry's `message`) is now passed as `error(status, message, properties)`; the resulting `HttpError` is unchanged for every body that fits `App.Error` (a non-string `message` field now yields Kit's default `Error: <status>` message).
