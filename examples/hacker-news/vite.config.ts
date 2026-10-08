import { sveltekit } from "@sveltejs/kit/vite";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import adapter from "@thomasfosterau/effect-sveltekit/adapter";
import { effectKit } from "@thomasfosterau/effect-sveltekit/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

/** Svelte compiler options shared by the app and the smoke test. */
const compilerOptions = {
  experimental: {
    // Required by SvelteKit's remote functions (used on /bookmarks).
    async: true,
  },
};

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
      compilerOptions,
      // The Effect deployment adapter: the production server (node build) runs
      // on @effect/platform's NodeHttpServer with Effect-managed lifecycle.
      adapter: adapter(),
      experimental: {
        // Required for the RemoteFunction demo on the /bookmarks page.
        remoteFunctions: true,
      },
    }),
  ],

  /**
   * `vp test` — the runtime smoke test (`pnpm run smoke`, #136). It mounts the
   * layout and the /bookmarks page in happy-dom against the packages'
   * `dist/`, so it runs after `vp run -r build` (it is not a `test` script,
   * which `vp run -r test` would run before the build).
   *
   * The project does not extend the plugins above: it compiles components
   * with the plain Svelte plugin (same compiler options, `browser` condition
   * for Svelte's client build), points `$app/state` at a stub, and the test
   * mocks the page's remote functions, so nothing touches the network or a
   * SvelteKit server.
   */
  test: {
    projects: [
      {
        plugins: [svelte({ configFile: false, preprocess: vitePreprocess(), compilerOptions })],
        resolve: {
          conditions: ["browser"],
          alias: {
            "$app/state": fileURLToPath(new URL("tests/stubs/app-state.ts", import.meta.url)),
          },
        },
        test: {
          name: "smoke",
          include: ["tests/**/*.test.ts"],
          environment: "happy-dom",
        },
      },
    ],
  },
});
