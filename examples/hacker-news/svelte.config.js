import adapter from "@thomasfosterau/effect-sveltekit/adapter";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  compilerOptions: {
    experimental: {
      // Required by SvelteKit's remote functions (used on /bookmarks).
      async: true,
    },
  },
  kit: {
    // The Effect deployment adapter: the production server (node build) runs
    // on @effect/platform's NodeHttpServer with Effect-managed lifecycle.
    adapter: adapter(),
    experimental: {
      // Required for the RemoteFunction demo on the /bookmarks page.
      remoteFunctions: true,
    },
  },
};

export default config;
