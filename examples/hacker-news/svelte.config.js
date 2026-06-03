import adapter from "@sveltejs/adapter-node";
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
    adapter: adapter(),
    experimental: {
      // Required for the RemoteFunction demo on the /bookmarks page.
      remoteFunctions: true,
    },
  },
};

export default config;
