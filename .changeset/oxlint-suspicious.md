---
"@thomasfosterau/effect-svelte": patch
"@thomasfosterau/effect-sveltekit": patch
---

Declarations drop type arguments that restate their defaults (`Effect.Effect<A, E, never>` is now written `Effect.Effect<A, E>`), and `SignalEmitter`'s private fields lose their leading underscores. The types themselves are unchanged.
