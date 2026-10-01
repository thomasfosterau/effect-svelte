# effect-svelte

Effect v4 integrations for Svelte 5 runes and SvelteKit, published as two npm
packages from this monorepo.

| Package                                                           | Directory            | Purpose                                                                                                                                |
| ----------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [`@thomasfosterau/effect-svelte`](./packages/svelte#readme)       | `packages/svelte`    | Effect integration for Svelte 5 runes: a runtime context, hooks that expose an `AsyncResult` via `.current`, atoms, and store interop. |
| [`@thomasfosterau/effect-sveltekit`](./packages/sveltekit#readme) | `packages/sveltekit` | SvelteKit load/action/endpoint/hook wrappers, remote functions, the `effectKit()` Vite plugin and an Effect deployment adapter.        |

Each package's README is its API reference; [`docs/cookbook.md`](./docs/cookbook.md)
holds longer recipes.

## Examples

The [`examples/`](./examples) directory contains three example apps, modelled
on widely used demo applications; [`examples/README.md`](./examples/README.md)
maps which exports each one exercises:

| Example                                                        | App                                              | Demonstrates                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| [`examples/todomvc`](./examples/todomvc)                       | [TodoMVC](https://todomvc.com) (Svelte 5 + Vite) | `reactiveQuery`, `reactiveMutation`, `useInvalidateKeys`, `AsyncResult`, Effect services with localStorage       |
| [`examples/hacker-news`](./examples/hacker-news)               | Hacker News reader (SvelteKit)                   | `effectKit()` Vite plugin, `makeServerRuntime`, `effectAdapter`, load/action/endpoint wrappers, remote functions |
| [`examples/realtime-dashboard`](./examples/realtime-dashboard) | Market dashboard (Svelte 5 + Vite)               | `useStream`, `useSubscriptionRef`, `usePubSub`, `SignalEmitter`, scopes, interruption                            |

```bash
pnpm install
pnpm run build          # builds every workspace package (vp run -r build)
cd examples/todomvc     # (or hacker-news / realtime-dashboard)
pnpm run dev
```

## Development

Setup, commands and the pre-PR checklist are in
[CONTRIBUTING.md](./CONTRIBUTING.md). Releases are automated with Changesets
and npm trusted publishing (OIDC); see [docs/RELEASING.md](./docs/RELEASING.md).

## License

MIT
