---
"@thomasfosterau/effect-sveltekit": minor
---

`Realtime.fromEventSource` and `Realtime.fromWebSocket` now fail with `EventSourceError` / `WebSocketError` when the `EventSource` / `WebSocket` constructor throws (for example a `SyntaxError` for an invalid URL, or for an invalid `WebSocket` protocol list). Both errors gain an optional `cause` field holding the thrown value. Previously the throw was lost: on `effect` 4.0.0 and 4.0.1 the stream hung without emitting, ending or failing, and on later versions it died with a defect. Nothing is left to close when construction fails.
