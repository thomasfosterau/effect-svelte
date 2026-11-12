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

import effect from "@enfect/oxlint";
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
    // oxlint's built-in plugins beyond its defaults (`import`, `promise`,
    // `vitest`), so `correctness`, `perf` and `suspicious` cover them too.
    plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "promise", "vitest"],
    categories: {
      correctness: "error",
      perf: "error",
      suspicious: "error",
    },
    rules: {
      // `_tag` is Effect's discriminant (tagged errors, `Data.TaggedEnum`,
      // `Exit`, `Cause` reasons), which tests and error mappers read.
      "eslint/no-underscore-dangle": ["error", { allow: ["_tag"] }],
      // `SvelteRuntime` and `SvelteKitRuntime` are published static-only
      // namespaces; turning them into modules would break every consumer.
      "typescript/no-extraneous-class": ["error", { allowStaticOnly: true }],
      // Cannot apply (owner decision, #213): a React-only rule that matches a
      // call by NAME (`useEffect`, `useState`, …) without checking where it is
      // imported from. effect-svelte's own Svelte rune hook is named
      // `useEffect`, and there is no React in this repo. Apps that call the
      // hook under this preset need the same line.
      "effect/avoid-react-hooks": "off",
      "vite-plus/prefer-vite-plus-imports": "error",
      // The suites assert through their own helpers (`expectFailsWith`,
      // `expectFailure`, ...) as well as `expect` / `assert`.
      "vitest/expect-expect": [
        "error",
        { assertFunctionNames: ["expect", "expect*", "assert", "assert.*"] },
      ],
      // `@effect/vitest`'s testers are test blocks too.
      "vitest/no-standalone-expect": [
        "error",
        {
          additionalTestBlockFunctions: ["it.effect", "it.effect.each", "it.live", "it.live.each"],
        },
      ],
    },
    overrides: [
      // The fallback signatures of the `Forms` type-level tests: each exists
      // to accept what the real signature rejects — explicit type arguments
      // (`deserialize<string, undefined>()`), or a handlers object of any type,
      // interface-typed and misspelt keys included — so the test can assert
      // the rejection as a type instead of an expect-error directive. A type
      // argument can only be accepted by a type parameter, and nothing in a
      // fallback relates to it, so these parameters are single-use by design.
      {
        files: ["packages/sveltekit/tests/client/fixtures/rejected-calls.ts"],
        rules: {
          "typescript/no-unnecessary-type-parameters": "off",
        },
      },
      // The runtime edge. These packages are a runtime boundary: Svelte
      // (constructors, `$effect` teardowns) and SvelteKit (loads, actions,
      // endpoints, hooks, `use:enhance` and navigation callbacks) call in
      // through Promise / callback APIs, so something must run the caller's
      // Effect when no runtime was supplied. These two modules are the only
      // place that happens; every other file, tests included, has the rule on.
      {
        files: ["packages/svelte/src/internal/run.ts", "packages/sveltekit/src/internal/run.ts"],
        rules: { "effect/effect-run-in-body": "off" },
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
        },
      },
      // Type assertions are errors everywhere (`effect/casting-awareness`,
      // `typescript/no-unsafe-type-assertion`) except in this one module.
      // Cannot apply there: it holds effect-sveltekit's narrowings that
      // neither the compiler nor a runtime check can verify (an Effect's or a
      // layer's phantom requirements at the generated-code and
      // request-context boundaries, conditional types on a signature's own
      // type parameters, SvelteKit's per-validator overloads, the translator
      // that returns an `ActionFailure`, a catalogue keyed by `_tag`). Each is
      // one documented function with a `// SAFETY:` comment; a new one has to
      // be added to that file, with its reason.
      {
        files: ["packages/sveltekit/src/internal/unchecked.ts"],
        rules: {
          "effect/casting-awareness": "off",
          "typescript/no-unsafe-type-assertion": "off",
        },
      },
      // Cannot apply: the rule bans the `node:http` import outright, taking it
      // for an outbound request (its fix is `HttpClient`). `adapter/serve.ts`
      // starts the production HTTP SERVER, and every `NodeHttpServer`
      // constructor in `@effect/platform-node` (`layer`, `layerConfig`,
      // `layerServer`, `make`) takes the `node:http` server factory as its
      // first argument: `createServer` has to be imported from somewhere.
      {
        files: ["packages/sveltekit/src/adapter/serve.ts"],
        rules: { "effect/use-http-client-service": "off" },
      },
    ],
    // Type-aware lint through vite-plus's bundled oxlint-tsgolint: the
    // type-aware rules (floating promises and the like), plus `typeCheck`,
    // which reports TypeScript errors in the `.ts` files from `vp check`
    // itself. Measured on 2026-10-30: zero findings on this tree, a planted
    // TS2322 is caught, and it adds ~3 s to `vp lint`. It does not replace
    // the `check` task (svelte-check), which alone reads `.svelte` files.
    options: {
      typeAware: true,
      typeCheck: true,
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
    // CHANGELOG.md is written by `changeset version`: left as generated, so a
    // "chore: version packages" PR can never fail the format check.
    ignorePatterns: ["**/dist/**", "**/coverage/**", "**/CHANGELOG.md"],
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
