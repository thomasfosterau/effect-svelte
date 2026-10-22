import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite-plus";

export default defineConfig({
  /**
   * `vp pack` (tsdown) builds the publishable Svelte runes library.
   *
   * `unbundle` keeps a 1:1 mapping between source modules and output files so
   * the `.svelte.ts` modules keep their `.svelte.js` extension in `dist/`,
   * which the Svelte compiler relies on to process runes inside published
   * packages.
   */
  pack: {
    entry: ["src/index.ts"],
    format: ["esm"],
    platform: "neutral",
    unbundle: true,
    // Declarations come from the TS6 JS compiler (the `typescript` alias): the
    // `tsgo` generator only discovers `@typescript/native-preview` or an
    // unaliased TypeScript 7, neither of which the workspace installs.
    dts: true,
    sourcemap: true,
  },

  /**
   * `vp test` (Vitest). Split into three projects because component fixtures
   * must be compiled differently per target:
   *
   * - `unit` — plain Node. The rune-free orchestrators and internal helpers
   *   (the bulk of the suite), tested without a Svelte/DOM environment.
   * - `dom` — happy-dom with the `browser` resolve condition, so Svelte resolves
   *   to its client build and components can be `mount`ed. Drives the live
   *   `<svelte:boundary>` behaviour.
   * - `ssr` — Node with the Svelte plugin but no `browser` condition, so Svelte
   *   resolves to its server build and `svelte/server`'s `render` produces HTML.
   */
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/dom/**", "tests/ssr/**"],
          environment: "node",
        },
      },
      {
        plugins: [svelte()],
        resolve: { conditions: ["browser"] },
        test: {
          name: "dom",
          include: ["tests/dom/**/*.test.ts"],
          environment: "happy-dom",
        },
      },
      {
        plugins: [svelte()],
        test: {
          name: "ssr",
          include: ["tests/ssr/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
