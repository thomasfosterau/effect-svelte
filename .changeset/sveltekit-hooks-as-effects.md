---
"@thomasfosterau/effect-sveltekit": minor
---

Group the SvelteKit hook helpers into a `Hooks` namespace, one per hook file,
and complete the set so every hook can be written as an Effect:

- `@thomasfosterau/effect-sveltekit` → `Hooks.reroute`, `Hooks.transport`,
  `Hooks.transporter` (universal `hooks.ts`).
- `@thomasfosterau/effect-sveltekit/server` → `Hooks.handle`,
  `Hooks.handleFetch`, `Hooks.handleError`, `Hooks.init` (`hooks.server.ts`).
- `@thomasfosterau/effect-sveltekit/client` → `Hooks.handleError`, `Hooks.init`
  (`hooks.client.ts`).

`handleFetch`, `handleError`, and `init` are new (previously only the
`effectKit()` auto-wrap path covered them); the matching `ServerRuntime`
methods (`handleFetch`/`handleError`/`init`) make them available with an
app-wide layer's services.

The previously flat `handle`, `reroute`, `transport`, and `transporter` exports
now live under `Hooks` (e.g. `Hooks.handle`, `Hooks.transport`).
