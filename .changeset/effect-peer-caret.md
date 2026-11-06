---
"@thomasfosterau/effect-svelte": patch
"@thomasfosterau/effect-sveltekit": patch
---

The `effect` peer range is now `^4.0.0` (was `>=4.0.2`), and so is effect-sveltekit's optional `@effect/platform-node` peer, per the peer-range policy: the floor is raised only when a dependency requires it. To support 4.0.0 and 4.0.1, `Store.toStream`, the SvelteKit `page` / `navigating` / `updated` streams and `Realtime.fromEventSource` / `fromWebSocket` again forward a failed setup to the stream themselves (on those releases `Stream.callback` dropped it and the stream hung); on 4.0.2 and later this changes nothing.
