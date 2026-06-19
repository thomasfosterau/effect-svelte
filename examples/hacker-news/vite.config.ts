import { sveltekit } from "@sveltejs/kit/vite";
import { effectKit } from "@thomasfosterau/effect-sveltekit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // effectKit() must run before sveltekit() so that route exports written as
  // Effects (or functions returning Effects) are rewritten first.
  //
  // `serverRuntime` points at the app-wide Effect runtime: bare-Effect
  // exports in server route files can use the services of its layer
  // (HackerNews, Bookmarks) without providing them per route.
  plugins: [effectKit({ serverRuntime: "$lib/server/runtime" }), sveltekit()],
});
