---
"@thomasfosterau/effect-sveltekit": minor
---

Add `Errors.toSvelteKit(catalogue)` (on `./server`): build a `translateError` from a tag-keyed error catalogue — a status, `{ status, message }`, `"status"`, `"redirect"` or a function per tag, with `SvelteKit.translate` (or `Errors.rethrowSquashed`) as the fallback. Add `ResponseHeaders`, a response-headers buffer that can be returned from `load`, with `Hooks.responseHeadersTransporter` as its `transport` entry and `appendTo` to copy it onto the response.
