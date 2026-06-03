# effect-svelte

Effect integrations for Svelte 5 runes and SvelteKit, published as a single package:
`@thomasfosterau/effect-svelte`.

- `@thomasfosterau/effect-svelte` - Svelte 5 runes integration for Effect
- `@thomasfosterau/effect-svelte/kit` - SvelteKit helpers (universal)
- `@thomasfosterau/effect-svelte/kit/server` - SvelteKit server-only helpers
- `@thomasfosterau/effect-svelte/kit/client` - SvelteKit client-only helpers
- `@thomasfosterau/effect-svelte/kit/vite` - The `effectKit()` Vite plugin

## Installation

```bash
npm install @thomasfosterau/effect-svelte effect svelte
```

If you use the SvelteKit helpers, you also need the (optional) SvelteKit peer
dependencies:

```bash
npm install @thomasfosterau/effect-svelte effect svelte @sveltejs/kit @effect/platform
```

## Usage

### Svelte runtime and hooks

```ts
import { provideRuntime, useEffect, derived } from "@thomasfosterau/effect-svelte";
```

### SvelteKit Vite plugin (recommended)

```ts
// vite.config.ts
import { sveltekit } from "@sveltejs/kit/vite";
import { effectKit } from "@thomasfosterau/effect-svelte/kit/vite";

export default {
  plugins: [effectKit(), sveltekit()],
};
```

With the plugin installed, you can return an Effect (or a function returning
an Effect) directly from any standard SvelteKit route file (`+page.ts`,
`+page.server.ts`, `+layout(.server).ts`, `+server.ts`,
`hooks.(server|client).ts`):

```ts
// +page.server.ts
import { Effect } from "effect";

export const load = (event) => Effect.succeed({ id: event.params.id });
```

The plugin rewrites the export so it goes through the same runtime as the
explicit wrappers below; plain promise/value-returning functions pass through
unchanged.

#### Supported exports

| File                | Exports auto-wrapped                                                   |
| ------------------- | ---------------------------------------------------------------------- |
| `+page.ts`          | `load`                                                                 |
| `+page.server.ts`   | `load`, `actions`                                                      |
| `+layout.ts`        | `load`                                                                 |
| `+layout.server.ts` | `load`                                                                 |
| `+server.ts`        | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `HEAD`, `fallback` |
| `hooks.server.ts`   | `handle`, `handleFetch`, `handleError`, `init`                         |
| `hooks.client.ts`   | `handleError`, `init`                                                  |

Config exports like `prerender`, `ssr`, `csr`, and `trailingSlash` are never
touched.

### SvelteKit universal load

```ts
import { load } from "@thomasfosterau/effect-svelte/kit";
```

### SvelteKit server helpers

```ts
import {
  serverLoad,
  action,
  actions,
  handle,
  endpoint,
} from "@thomasfosterau/effect-svelte/kit/server";
```

### SvelteKit client helpers

```ts
import { placeholder } from "@thomasfosterau/effect-svelte/kit/client";
```

## Examples

The [`examples/`](./examples) directory contains three example apps, modelled
on widely used demo applications, that together exercise the entire API
surface:

| Example                                                        | App                                              | Demonstrates                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| [`examples/todomvc`](./examples/todomvc)                       | [TodoMVC](https://todomvc.com) (Svelte 5 + Vite) | `reactiveQuery`, `reactiveMutation`, `useInvalidateKeys`, `AsyncResult`, Effect services with localStorage   |
| [`examples/hacker-news`](./examples/hacker-news)               | Hacker News reader (SvelteKit)                   | `effectKit()` Vite plugin, `serverLoad`/`load`/`actions`/`endpoint` wrappers, remote functions, `HttpClient` |
| [`examples/realtime-dashboard`](./examples/realtime-dashboard) | Market dashboard (Svelte 5 + Vite)               | `useStream`, `useSubscriptionRef`, `usePubSub`, `SignalEmitter`, scopes, interruption                        |

```bash
pnpm install
pnpm run build          # build the package first
cd examples/todomvc     # (or hacker-news / realtime-dashboard)
pnpm run dev
```

See [`examples/README.md`](./examples/README.md) for the full API-to-example
coverage map.

## Development

This repository is managed by [Vite+](https://viteplus.dev). Day-to-day
commands:

```bash
vp install   # Install dependencies
vp check     # Format, lint, and type-check
vp test      # Run the test suite (Vitest)
vp pack      # Build the library (tsdown)
```

If you don't have the `vp` global CLI installed, every command is also
available through the package scripts (`pnpm run check`, `pnpm run test`,
`pnpm run build`, ...), or install it with:

```bash
curl -fsSL https://vite.plus | bash
```

All tooling (build, test, lint, format) is configured in a single
`vite.config.ts` at the repository root.

### Project layout

```
src/           Svelte 5 runes integration (package root export)
src/kit/       SvelteKit helpers (./kit subpath exports)
tests/         Vitest test suite
examples/      Example apps (TodoMVC, Hacker News, real-time dashboard)
vite.config.ts Vite+ configuration (pack, test, lint, fmt)
```

## Release workflow

Changesets is configured at the repository root.

```bash
vp run changeset   # Create a changeset
vp run version     # Apply pending changesets to the package version
vp run release     # Build and publish to npm
```

## License

MIT
