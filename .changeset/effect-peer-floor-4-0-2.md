---
"@thomasfosterau/effect-svelte": minor
"@thomasfosterau/effect-sveltekit": minor
---

The `effect` peer range is now `>=4.0.2` (was `>=4.0.0-rc.118`), and `effect-sveltekit`'s optional `@effect/platform-node` peer is `>=4.0.2` too. 4.0.2 is the release both packages are built and tested against, so the published floor is now a tested version. If your app is on an `effect` 4.0 release candidate, 4.0.0 or 4.0.1, upgrade `effect` (and every `@effect/*` package, which must stay on the same version as `effect`) to 4.0.2 or later; the install commands in the READMEs no longer use the `rc` dist-tag, which still points at `4.0.0-rc.118`.
