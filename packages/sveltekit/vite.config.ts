import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite-plus";

const fixture = (path: string): string =>
  fileURLToPath(new URL(`./tests/client/fixtures/${path}`, import.meta.url));

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
      // exclusively in Node (vite.config.ts / the production server).
      neverBundle: [/^\$app\//, /^node:/],
    },
  },

  /**
   * `vp test` (Vitest), in two projects:
   *
   * - `unit` — plain Node, the bulk of the suite. Nothing here imports a
   *   `$app/*` module at runtime; the public wrappers are tested through their
   *   rune-free cores in `src/internal/`.
   * - `client` — happy-dom plus the Svelte plugin (so `.svelte.ts` runes
   *   compile for the client) with the `browser` resolve condition (so Svelte
   *   resolves to its client build and effects run), and `$app/state` / `$app/navigation` aliased to rune-backed
   *   stand-ins, so the `$app/state` bridge is tested end to end.
   */
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/client/**"],
          environment: "node",
        },
      },
      {
        plugins: [svelte()],
        resolve: {
          conditions: ["browser"],
          alias: [
            { find: /^\$app\/state$/, replacement: fixture("app-state.svelte.ts") },
            { find: /^\$app\/navigation$/, replacement: fixture("app-navigation.ts") },
          ],
        },
        test: {
          name: "client",
          include: ["tests/client/**/*.test.ts"],
          // A DOM environment makes Vitest use the web (not SSR) transform, so
          // the Svelte plugin compiles `.svelte.ts` for the client.
          environment: "happy-dom",
        },
      },
    ],
  },
});
