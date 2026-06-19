import { defineConfig } from "vite-plus";

/**
 * Workspace-root Vite+ configuration.
 *
 * Per-package `pack` / `test` config lives in each package's own
 * `vite.config.ts` (`packages/svelte`, `packages/sveltekit`). This root config
 * holds the workspace-wide concerns: monorepo task caching, and the lint/format
 * settings applied across every package.
 */
export default defineConfig({
  run: {
    cache: true,
  },

  /** `vp check` (Oxlint + tsgolint) — type-aware across all packages. */
  lint: {
    // The example apps are excluded from the root type-aware lint: they can
    // only resolve the workspace packages (and SvelteKit's generated tsconfig)
    // after a build / `svelte-kit sync`. CI validates them separately with
    // svelte-check.
    ignorePatterns: ["**/dist/**", "examples/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },

  /** `vp check` (Oxfmt) */
  fmt: {
    ignorePatterns: ["**/dist/**"],
  },
});
