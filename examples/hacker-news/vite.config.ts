import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import adapter from "@thomasfosterau/effect-sveltekit/adapter";
import { effectKit } from "@thomasfosterau/effect-sveltekit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // effectKit() must run before sveltekit() so that route exports written as
  // Effects (or functions returning Effects) are rewritten first.
  //
  // `serverRuntime` points at the app-wide Effect runtime: bare-Effect
  // exports in server route files can use the services of its layer
  // (HackerNews, Bookmarks) without providing them per route.
  plugins: [
    effectKit({ serverRuntime: "#lib/server/runtime.ts" }),
    // SvelteKit 3 takes its configuration here; `svelte.config.js` is no
    // longer read.
    sveltekit({
      preprocess: vitePreprocess(),
      compilerOptions: {
        experimental: {
          // Required by SvelteKit's remote functions (used on /bookmarks).
          async: true,
        },
      },
      // The Effect deployment adapter: the production server (node build) runs
      // on @effect/platform's NodeHttpServer with Effect-managed lifecycle.
      adapter: adapter(),
      experimental: {
        // Required for the RemoteFunction demo on the /bookmarks page.
        remoteFunctions: true,
      },
    }),
  ],
});
