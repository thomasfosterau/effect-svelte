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
    dts: { tsgo: true },
    sourcemap: true,
  },

  /** `vp test` (Vitest) */
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
