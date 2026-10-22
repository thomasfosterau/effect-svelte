/**
 * Svelte compiler options shared by the Vite plugin (the `dom` / `ssr` test
 * projects in vite.config.ts) and svelte-check (the `check` task).
 *
 * `experimental.async` lets component fixtures use `{await ...}` in templates
 * under `<svelte:boundary>` — the surface `useLiveStream`'s `promise` is
 * designed for.
 *
 * @type {import("@sveltejs/vite-plugin-svelte").SvelteConfig}
 */
export default {
  compilerOptions: { experimental: { async: true } },
};
