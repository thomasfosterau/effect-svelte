/**
 * Workspace-root Vite+ configuration. Owns the repo-wide format/lint/staged
 * passes (read statically by `vp fmt` / `vp lint` / `vp staged`) and the root
 * aggregates (`check`, `test:coverage`).
 *
 * Per-package `pack` / `test` config lives in each package's own
 * `vite.config.ts` (`packages/svelte`, `packages/sveltekit`), and each
 * package's `check` / `test:unit` / `build` are scripts in its
 * `package.json`. A new package adds itself to the aggregate lists below.
 *
 * Shape copied from the effect-web library's root config.
 */

import effect from "@mpsuesser/oxlint-plugin-effect";
import { defineConfig } from "vite-plus";

export default defineConfig({
  // Staged-file checks run by `vp staged` (pre-commit, installed by `vp config`
  // in the root `prepare`). oxfmt cannot format `.svelte`, so Svelte files go
  // through lint alone.
  staged: {
    "*.{js,ts,css,json,md}": "vp check --fix",
    "*.svelte": "vp lint --fix",
  },

  run: {
    cache: true,
    tasks: {
      // The type gate, as one task: every package's `check` (svelte-check
      // over `src`, `tests` and the `.svelte` fixtures, on the TS6 compiler).
      // A pure graph node; the packages are named explicitly because a
      // `from: "dependencies"` edge does not traverse the workspace root's own
      // devDependencies.
      check: {
        command: "echo 'check: every type gate green'",
        dependsOn: [
          "@thomasfosterau/effect-svelte#check",
          "@thomasfosterau/effect-sveltekit#check",
        ],
        cache: false,
      },
      // Every package's suite under one Istanbul coverage map
      // (`coverage/coverage-final.json`), which `fallow audit` reads for exact
      // per-function CRAP scores (`health.coverage` in .fallowrc.json).
      // Without it fallow estimates every function as uncovered, and any
      // function with cyclomatic complexity ≥ 5 fails the gate on its own.
      // Run this before `fallow audit` (the Claude Code PreToolUse fallow gate
      // runs the audit on `git commit` / `git push` but never refreshes this
      // map).
      "test:coverage": {
        command: "vp test run --coverage",
        cache: false,
      },
    },
  },

  /** `vp check` (Oxlint), plus `vp lint` on its own. */
  lint: {
    ignorePatterns: ["**/dist/**", "**/coverage/**", "**/node_modules/**"],
    extends: [effect.configs.recommended],
    categories: {
      correctness: "error",
    },
    rules: {
      // `casting-awareness` is an awareness prompt, not a defect rule — it
      // fires on every `as`, including the narrowings Svelte's and SvelteKit's
      // types structurally require. Stays visible as a warning.
      "effect/casting-awareness": "warn",
      // Hard-codes abbreviations (`Arr`, `P`, `R`, …) with no options, so it is
      // unsatisfiable under the full-name convention (`import * as Option from
      // "effect/Option"`) this family shares with its consumers.
      "effect/prefer-namespace-imports": "off",
      // These packages ARE the runtime boundary the rule asks for: Svelte
      // components, rune hooks, SvelteKit loads, actions, endpoints and remote
      // functions are Promise/callback APIs that call into this code, so every
      // `Effect.runPromise` / `runSync` / `runFork` here is the edge that runs
      // a caller's Effect (and in tests, the test harness the rule exempts).
      "effect/effect-run-in-body": "off",
      // React-specific: it fires on the name `useEffect`, which here is this
      // package's own Svelte rune hook (`useEffect` from
      // @thomasfosterau/effect-svelte), not React's.
      "effect/avoid-react-hooks": "off",
      // Its only fix contradicts the workspace's `exactOptionalPropertyTypes`
      // convention (AGENTS.md): an optional member a caller may forward
      // `undefined` into MUST be spelled `?: T | undefined`, which is most of
      // its sites. The rest are published signatures that return `undefined`
      // to Svelte templates (`{#if x}`), where an `Option` would be a breaking
      // API change for every consumer.
      "effect/prefer-option-over-null": "off",
      // It flags any imported `make*` function as an Effect service constructor
      // that should come in through a Layer. Every `make*` these packages
      // import is a plain factory with no Layer behind it — a rune state
      // holder (`makeResult`, `makeMutation`, `makeLiveStream`), a runtime
      // builder (`makeServerRuntime`, `makeUniversalRuntime`) or a test
      // helper (`makeRunHelpers`) — so the rule has no service to point at.
      "effect/no-service-constructor-imports": "off",
      "vite-plus/prefer-vite-plus-imports": "error",

      // ---- Effect preset: published-API allowances -------------------------
      // Each remaining site can only be fixed by changing a PUBLISHED
      // signature, error class or thrown / logged behaviour, so the rule sits
      // at `warn` (a new site is a defect, not headroom) until #185 decides
      // each one. Once a rule's count reaches zero its line is deleted, so it
      // is back at the preset's `error`. Counts as of the tooling-standard PR.
      "effect/no-unsafe-dictionary-type": "warn", // 13
      "effect/avoid-untagged-errors": "warn", // 7
      "effect/avoid-data-tagged-error": "warn", // 6
      "effect/no-unknown-returns": "warn", // 5
      "effect/no-unknown-parameters": "warn", // 5
      "effect/no-shape-in-symbol-names": "warn", // 5
      "effect/effect-promise-vs-trypromise": "warn", // 3
      "effect/use-console-service": "warn", // 2
      "effect/avoid-native-object-helpers": "warn", // 2
      "effect/no-known-value-widening": "warn", // 2
      "effect/avoid-direct-json": "warn", // 1
      "effect/no-chained-type-assertions": "warn", // 1
      "effect/avoid-any": "warn", // 1
      "effect/no-unknown-type-aliases": "warn", // 1
    },
    overrides: [
      // Build/test configs are evaluated by Vite and Vitest in bare Node,
      // before any Effect runtime exists — there is no `Config` provider to
      // read from and no `FileSystem` service to call, so `process.env` and
      // `node:*` are the only things that work there. The Effect preset's
      // service rules have no satisfiable fix in these files.
      {
        files: ["**/vite.config.ts", "**/svelte.config.js"],
        rules: {
          "effect/avoid-node-imports": "off",
          "effect/avoid-process-env": "off",
          "effect/use-path-service": "off",
        },
      },
      // Build-time hooks: the `effectKit()` Vite plugin (`src/vite.ts`) and
      // the adapter's `adapt(builder)` (`src/adapter/index.ts`) are called by
      // Vite and SvelteKit's builder in bare Node, with no Effect runtime or
      // platform layer in scope, and write the build's output files through
      // the paths the builder hands them. `JSON.stringify` there emits a JS
      // string literal into generated source; it is not a data boundary.
      {
        files: ["packages/sveltekit/src/vite.ts", "packages/sveltekit/src/adapter/index.ts"],
        rules: {
          "effect/avoid-node-imports": "off",
          "effect/avoid-sync-fs": "off",
          "effect/use-filesystem-service": "off",
          "effect/use-path-service": "off",
          "effect/avoid-direct-json": "off",
        },
      },
      // Import boundaries on EXTERNAL specifiers (AGENTS.md § Common
      // pitfalls); the boundaries between this repo's own files are fallow
      // zones in .fallowrc.json. effect-svelte must work in a plain Svelte
      // app, so it never names SvelteKit at all.
      {
        files: ["packages/svelte/src/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: ["@sveltejs/kit", "@sveltejs/kit/**", "$app/**", "$env/**"],
                  message:
                    "effect-svelte must work in a plain Svelte app: SvelteKit belongs in effect-sveltekit.",
                },
              ],
            },
          ],
        },
      },
      // effect-sveltekit's code runs on server and client alike except under
      // `./server`, `./client`, `./adapter*` and the build hooks: a `$app/*`
      // VALUE import there would break whichever side lacks it (a type-only
      // import is erased, so it is allowed), and `$env/*` / `node:` never
      // resolve on the client.
      {
        files: ["packages/sveltekit/src/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: ["$app/**"],
                  allowTypeImports: true,
                  message:
                    "A `$app/*` value import belongs under ./server (`$app/server`) or ./client (`$app/navigation`, `$app/state`, `$app/forms`); the root entry is universal.",
                },
                {
                  group: ["$env/**"],
                  message:
                    "Take configuration as an argument (`sveltekitConfig`); `$env/*` is the app's.",
                },
                {
                  group: ["node:*"],
                  message: "Node-only code belongs under ./adapter*; the root entry is universal.",
                },
              ],
            },
          ],
        },
      },
      {
        // The server and client entries may reach their own `$app/*` modules.
        files: [
          "packages/sveltekit/src/server.ts",
          "packages/sveltekit/src/server/**",
          "packages/sveltekit/src/remote-functions.ts",
          "packages/sveltekit/src/client.ts",
          "packages/sveltekit/src/client/**",
          "packages/sveltekit/src/Navigation.ts",
          "packages/sveltekit/src/State.ts",
          "packages/sveltekit/src/forms.ts",
          "packages/sveltekit/src/internal/app-state.ts",
          "packages/sveltekit/src/internal/enhance.ts",
          "packages/sveltekit/src/internal/navigation-events.ts",
        ],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: ["$env/**"],
                  message:
                    "Take configuration as an argument (`sveltekitConfig`); `$env/*` is the app's.",
                },
                {
                  group: ["node:*"],
                  message: "Node-only code belongs under ./adapter*.",
                },
              ],
            },
          ],
        },
      },
      {
        // Node-only entries: the adapter (build hook + production server) and
        // the Vite plugin.
        files: ["packages/sveltekit/src/adapter/**", "packages/sveltekit/src/vite.ts"],
        rules: {
          "no-restricted-imports": "off",
          // `adapter/serve.ts` starts the production HTTP SERVER with
          // `node:http`'s `createServer`; the rule's fix (`HttpClient`) is for
          // outbound requests.
          "effect/use-http-client-service": "off",
        },
      },
      // The adapter test's mock `Builder.generateServerInstance` must write
      // synchronously: SvelteKit's contract for it returns `void`, and the
      // test pins that `server.js` survives `adapt`'s earlier `rmSync(out)`.
      // An Effect `FileSystem` write could land after that and hide an
      // ordering bug. Every other file operation there uses `FileSystem`.
      {
        files: ["packages/sveltekit/tests/adapter.test.ts"],
        rules: {
          "effect/use-filesystem-service": "off",
          "effect/avoid-sync-fs": "off",
        },
      },
      // Tests.
      {
        files: ["**/tests/**"],
        rules: {
          // The expect-error directives in the suites ARE the type-level
          // assertions (a call that must fail to compile); deleting one deletes
          // the test.
          "effect/avoid-ts-ignore": "off",
          // The fixtures stand in for the foreign failures the packages must
          // absorb — a user callback that throws, a SvelteKit promise that
          // rejects with a plain `Error` — and the assertions check exactly
          // how such an untagged error surfaces (a defect, a 500, an
          // `ApplyActionError` cause). A tagged error would test a different
          // path.
          "effect/avoid-untagged-errors": "off",
        },
      },
    ],
    // Type-aware rules stay on (floating promises and the like); type
    // checking itself is the `check` task's job (svelte-check), which also
    // covers the `.svelte` fixtures tsgolint cannot read.
    options: {
      typeAware: true,
      typeCheck: false,
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
  },

  /** `vp check` (Oxfmt) */
  fmt: {
    ignorePatterns: ["**/dist/**", "**/coverage/**"],
  },

  test: {
    // One entry per package: each package's own vite.config.ts holds its
    // Vitest projects, so the root run and the root coverage map cover them
    // all.
    projects: ["packages/*/vite.config.ts"],
    coverage: {
      provider: "istanbul",
      // `json` writes coverage-final.json, the map `fallow audit` reads.
      reporter: ["text-summary", "json-summary", "json"],
      reportsDirectory: "./coverage",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.d.ts"],
    },
  },
});
