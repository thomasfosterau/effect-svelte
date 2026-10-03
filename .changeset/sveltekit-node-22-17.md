---
"@thomasfosterau/effect-sveltekit": patch
---

Raise `engines.node` from `^20.19.0 || >=22.12.0` to `>=22.17`, matching SvelteKit 3's own requirement.

Docs: the adapter section of the README notes that the optional `@effect/platform-node` peer pulls in `undici`, which needs Node `>=22.19`.
