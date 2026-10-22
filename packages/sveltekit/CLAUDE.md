# packages/sveltekit — `@thomasfosterau/effect-sveltekit`

SvelteKit integration for Effect v4: load / action / endpoint wrappers, remote functions, a universal runtime, the `effectKit()` Vite plugin and an Effect deployment adapter. Read the root [AGENTS.md](../../AGENTS.md) first.

## Entries and where code may go

| Entry                                               | Source                           | Runs on                                                            | May import                                                              |
| --------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `.`                                                 | `src/index.ts`                   | server **and** client                                              | universal modules only; `$app/*` as types only; no `$env/*`, no `node:` |
| `./server`                                          | `src/server.ts`, `src/server/**` | server                                                             | `$app/server`; universal modules                                        |
| `./client`                                          | `src/client.ts`, `src/client/**` | client                                                             | `$app/navigation`, `$app/state`, `$app/forms`; universal modules        |
| `./vite`                                            | `src/vite.ts`                    | Vite (Node, build time)                                            | `node:`                                                                 |
| `./testing`                                         | `src/testing.ts`                 | tests (Node)                                                       | universal and server modules                                            |
| `./adapter`, `./adapter/handler`, `./adapter/serve` | `src/adapter/**`                 | Node (build hook + production server)                              | `node:`                                                                 |
| `./internal/auto`                                   | `src/internal/auto.ts`           | whatever the `effectKit()` plugin's generated code imports it into | universal modules                                                       |

The fallow zones in `.fallowrc.json` enforce the "may import" column between this package's files (a new file outside the listed server / client / adapter / build zones is universal); `no-restricted-imports` overrides in the root `vite.config.ts` enforce the external specifiers. A new entry adds a row here, an entry in `pack.entry` (`vite.config.ts`), `exports` (`package.json`), `.fallowrc.json` (`entry` and a zone) and the package `README.md`.

## Invariants

- **No source file matches SvelteKit's remote-module matcher** (`/[/.]remote(\.[^/]+)+$/`, e.g. `remote.server.ts`, `*.remote.ts`): kit's build rejects a built file whose exports are not all remote functions. That is why the factories live in `src/remote-functions.ts`; `tests/remote-module-naming.test.ts` guards it.
- **`$app/*` and `node:` stay external** (`pack.deps.neverBundle`); the consuming app provides `$app/*`.
- **This package is a runtime boundary.** SvelteKit calls loads, actions, endpoints, hooks and remote functions as Promise APIs, so the wrappers run the caller's Effect there (the `effect/effect-run-in-body` lint rule is off for that reason). A failure the caller did not map surfaces as a 500 / `error()`, never as an unhandled rejection.
- **`@thomasfosterau/effect-svelte` is a dependency but is not imported.** It is kept deliberately (#186) so a compatible version installs alongside; the README tells consumers to list it themselves to import it, and fallow's `ignoreDependencies` records why.

## Tests

`tests/` runs in Node against the rune-free cores in `src/internal/`; `tests/client/` runs under happy-dom with the Svelte plugin and `$app/state` / `$app/navigation` / `$app/forms` aliased to the stand-ins in `tests/client/fixtures/`.
