---
"@thomasfosterau/effect-sveltekit": minor
---

Add a realtime bridge between Effect `Stream`s and SSE / WebSocket. Server: `Endpoint.fromStream(stream, { event, id, retry, heartbeat })` serves a `Stream` as a `text/event-stream` response. Client: the `Realtime` namespace adds `fromEventSource(url)` and `fromWebSocket(url)`, each consuming a source as an Effect `Stream` (#44).
