---
"@thomasfosterau/effect-svelte": patch
---

Add a `svelte` export condition to `package.json` (pointing at the same ESM
files as `import`), so bundlers detect this package as a Svelte library.
Without it, Vite prebundles the package with its own copy of Svelte's context
internals (every `setContext` throws `lifecycle_outside_component`), and
Vitest resolves Svelte's server runtime in jsdom projects — consumers no
longer need `optimizeDeps.exclude` / `server.deps.inline` workarounds for this
package.
