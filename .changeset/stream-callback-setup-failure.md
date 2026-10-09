---
"@thomasfosterau/effect-svelte": patch
"@thomasfosterau/effect-sveltekit": patch
---

`Store.toStream` now dies with what the store's `subscribe` threw, instead of hanging, when `subscribe` throws (a store that breaks the readable store contract). On `effect` 4.0.0 and 4.0.1, `Stream.callback` dropped a failing setup and the stream hung without emitting, ending or failing; later versions already died. The `$app/state` streams in `effect-sveltekit` (`State.navigating`, `State.updated` and `State.CurrentPage`'s `changes`) get the same guard for their watcher setup.
