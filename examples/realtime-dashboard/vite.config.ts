import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [svelte()],

  /**
   * `vp test` — the runtime smoke test (`pnpm run smoke`, #136). It mounts the
   * app in happy-dom against the packages' `dist/`, so it runs after
   * `vp run -r build` (it is not a `test` script, which `vp run -r test`
   * would run before the build). The `browser` condition resolves Svelte to
   * its client build so `mount` works.
   */
  test: {
    projects: [
      {
        extends: true,
        resolve: { conditions: ["browser"] },
        test: {
          name: "smoke",
          include: ["tests/**/*.test.ts"],
          environment: "happy-dom",
        },
      },
    ],
  },
});
