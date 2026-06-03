import { defineConfig } from "vite-plus";

export default defineConfig({
  /**
   * `vp pack` (tsdown) builds the publishable library.
   *
   * `unbundle` keeps a 1:1 mapping between source modules and output files.
   * This is required so the Svelte runes modules keep their `.svelte.js`
   * extension in `dist/`, which the Svelte compiler relies on to process
   * runes inside published packages.
   */
  pack: {
    entry: [
      "src/index.ts",
      "src/kit/index.ts",
      "src/kit/server.ts",
      "src/kit/client.ts",
      "src/kit/vite.ts",
      "src/kit/adapter/index.ts",
      "src/kit/adapter/handler.ts",
      "src/kit/adapter/serve.ts",
      "src/kit/internal/auto.ts",
    ],
    format: ["esm"],
    platform: "neutral",
    unbundle: true,
    // Use the TypeScript Go compiler for declaration emit; the default
    // tsc-based emitter cannot handle the get-accessor type literals used
    // by the runes API.
    dts: { tsgo: true },
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

  /** `vp lint` / `vp check` (Oxlint + tsgolint) */
  lint: {
    // The example apps are excluded from the root type-aware lint: they can
    // only resolve the package (and SvelteKit's generated tsconfig) after
    // `vp pack` / `svelte-kit sync` have run. CI validates them separately
    // with `vp run --filter "example-*" typecheck` (svelte-check) after the
    // build.
    ignorePatterns: ["dist/**", "examples/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },

  /** `vp fmt` / `vp check` (Oxfmt) */
  fmt: {
    ignorePatterns: ["dist/**"],
  },
});
