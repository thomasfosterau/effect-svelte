import { defineConfig } from "vite-plus";

export default defineConfig({
  /**
   * `vp pack` (tsdown) builds the publishable SvelteKit library.
   *
   * `unbundle` keeps a 1:1 mapping between source modules and output files.
   */
  pack: {
    entry: [
      "src/index.ts",
      "src/server.ts",
      "src/client.ts",
      "src/vite.ts",
      "src/testing.ts",
      "src/adapter/index.ts",
      "src/adapter/handler.ts",
      "src/adapter/serve.ts",
      "src/internal/auto.ts",
    ],
    format: ["esm"],
    platform: "neutral",
    unbundle: true,
    // Declarations come from the TS6 JS compiler (the `typescript` alias): the
    // `tsgo` generator only discovers `@typescript/native-preview` or an
    // unaliased TypeScript 7, neither of which the 6/7 split installs.
    dts: true,
    sourcemap: true,
    deps: {
      // SvelteKit virtual modules are provided by the consumer's app.
      // Node builtins are only imported by the adapter modules, which run
      // exclusively in Node (svelte.config.js / the production server).
      neverBundle: [/^\$app\//, /^node:/],
    },
  },

  /** `vp test` (Vitest) */
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
