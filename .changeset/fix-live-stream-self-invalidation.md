---
"@thomasfosterau/effect-svelte": patch
---

Fix `useLiveStream` re-subscribing on every emission.

`startWaiting()` read the previous result inside the hook's `$effect`,
registering the result state itself as a dependency; every emission then wrote
that state, invalidating the effect and interrupting/re-subscribing the stream
for its whole lifetime. Symptoms: `current.waiting` never cleared after the
first emission, and the stream thunk re-ran roughly once per emission instead
of once per reactive-input change. The previous-value read is now untracked.
