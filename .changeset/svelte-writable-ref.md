---
"@thomasfosterau/effect-svelte": minor
---

Add `useWritableRef` — a two-way binding between an Effect `SubscriptionRef` and Svelte runes. Reading `current` tracks the ref reactively and assigning writes back, so it works directly with `bind:value`; `set` / `update` are also provided for imperative writes (#48).
