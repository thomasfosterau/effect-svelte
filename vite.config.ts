// Root config: repo-wide format, lint and staged passes, and the aggregate
// tasks. Each package's own vite.config.ts holds its pack and test config.

import effect from "@enfect/oxlint";
import { defineConfig } from "vite-plus";

export default defineConfig({
  // oxfmt cannot format `.svelte`, so Svelte files go through lint alone.
  staged: {
    "*.{js,ts,css,json,md}": "vp check --fix",
    "*.svelte": "vp lint --fix",
  },

  run: {
    cache: true,
    tasks: {
      // The packages are named explicitly: a `from: "dependencies"` edge does
      // not traverse the workspace root's own devDependencies.
      check: {
        command: "echo 'check: every type gate green'",
        dependsOn: [
          "@thomasfosterau/effect-svelte#check",
          "@thomasfosterau/effect-sveltekit#check",
        ],
        cache: false,
      },
      ci: {
        command:
          "vp check && vp run check && vp run -r test:unit && vp run -r build && pnpm audit --audit-level high",
        cache: false,
      },
      // One Istanbul map over every package, which `fallow audit` reads.
      "test:coverage": {
        command: "vp test run --coverage",
        cache: false,
      },
      fallow: {
        command: "vp exec fallow --summary",
        cache: false,
      },
      // Run by the pre-commit hook.
      "fallow:audit": {
        command: "vp exec fallow audit --base origin/trunk --quiet",
        dependsOn: ["test:coverage"],
        cache: false,
      },
      "changeset:version": {
        command: "changeset version && vp fmt && pnpm install --lockfile-only",
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
      // A React-only rule matching calls by name; effect-svelte's own rune
      // hook is named `useEffect`. Apps that call the hook need the same line.
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
      // Boundaries on external specifiers; boundaries between this repo's own
      // files are fallow zones in .fallowrc.json.
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
    // `typeCheck` reports TypeScript errors in `.ts` files; svelte-check (the
    // `check` task) is still the only gate that reads `.svelte` files.
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
    // CHANGELOG.md is written by `changeset version`.
    ignorePatterns: ["**/dist/**", "**/coverage/**", "**/CHANGELOG.md"],
  },

  test: {
    projects: ["packages/*/vite.config.ts"],
    coverage: {
      provider: "istanbul",
      reporter: ["text-summary", "json-summary", "json"],
      reportsDirectory: "./coverage",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.d.ts"],
    },
  },
});
