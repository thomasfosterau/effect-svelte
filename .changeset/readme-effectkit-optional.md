---
"@thomasfosterau/effect-sveltekit": patch
---

The README no longer labels the `effectKit()` Vite plugin "(recommended)". It now presents the explicit wrappers (`serverLoad`, `actions`, `endpoint`, the app-wide runtime's methods) first and the plugin afterwards as an optional convenience, and notes that SvelteKit's generated `$types` cannot see through the plugin's rewrite. The plugin itself is unchanged and stays supported.
