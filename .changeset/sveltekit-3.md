---
"@thomasfosterau/effect-sveltekit": minor
---

**Breaking:** require SvelteKit 3. The `@sveltejs/kit` peer range moves from `^2.0.0 || ^3.0.0-next.0` to `^3.0.0`, so apps on SvelteKit 2 or a `3.0.0-next` prerelease must upgrade `@sveltejs/kit` first (Kit 3 itself needs Node 22.17, Vite 8, `@sveltejs/vite-plugin-svelte` 7 and Svelte 5.57.1). The published types now import SvelteKit's types from their Kit 3 homes (`@sveltejs/kit/hooks`, `$app/server`, `$app/navigation`, `$app/state`, `$app/forms`).

- Adapter: the generated `build/server.js` exports the SvelteKit `server` instance (from `builder.generateServerInstance`), and `build/manifest.js` now exports `prerendered`, `base` and `appPath` instead of the SSR manifest. `makeHandler` / `makeHandlerWith` (`./adapter/handler`) take that `server` instead of the `Server` class and `manifest`, and `makeHandler` takes `appPath`. Configure the adapter in `vite.config.ts` (`sveltekit({ adapter: adapter() })`); Kit 3 no longer reads `svelte.config.js`.
- `Navigation.preloadCode` takes a route ID (e.g. `/blog/[slug]`), as Kit 3's `preloadCode` does. `Navigation.invalidateAll` is deprecated in favour of `Navigation.refreshAll`, following Kit 3.
- `Hooks.handleError` (server and client) passes Kit 3's `handleError` input through unchanged: it carries `kind` (`"app"`, `"framework"`, `"unknown"`, or `"validation"` on the server) and no longer `status` / `message`.
- Docs: examples import app modules through `#lib/…` (Kit 3 replaced the `$lib` alias), including the `effectKit({ serverRuntime })` specifier.
