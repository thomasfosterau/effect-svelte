---
"@thomasfosterau/effect-svelte": patch
"@thomasfosterau/effect-sveltekit": patch
---

Fix the `Stream.callback` helpers written against Effect v3's cleanup contract. Effect v4's `Stream.callback` runs the Effect its callback returns as the stream's setup, so the cleanup now goes in a finalizer on the stream's scope:

- `Store.toStream` no longer unsubscribes from the store as soon as the stream starts; it delivers every later update and unsubscribes when the stream ends or is interrupted.
- `SignalEmitter` no longer drops every `emit()` after the stream starts; `emit()` feeds the running stream and disconnects when it ends or is interrupted.
- `Realtime.fromEventSource` and `Realtime.fromWebSocket` now close the `EventSource` / `WebSocket` when the stream ends or is interrupted, instead of leaving it open.
