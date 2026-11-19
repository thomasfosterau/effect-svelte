# effect-svelte

[Effect](https://effect.website) v4 for Svelte 5 runes and SvelteKit: rune hooks that run Effects and Streams in components, and wrappers that let loads, actions, endpoints, hooks and remote functions return Effects.

> [!CAUTION]
> Experimental and pre-1.0, largely written with Claude Code. The API may change between minor versions.

## Install

```sh
pnpm add @thomasfosterau/effect-svelte effect svelte
pnpm add @thomasfosterau/effect-sveltekit @sveltejs/kit   # for SvelteKit
```

`effect` (`^4.0.0`) is a peer: keep a single copy in your app.

## Usage

```svelte
<script lang="ts">
  import { provideRuntime, useDerived, AsyncResult } from "@thomasfosterau/effect-svelte";
  import { Effect } from "effect";

  provideRuntime();
  let id = $state(1);
  const user = useDerived(() => Effect.succeed({ id, name: `User ${id}` }));
</script>

{#if AsyncResult.isSuccess(user.current)}<p>{user.current.value.name}</p>{/if}
```

```ts
// src/routes/items/[id]/+page.server.ts
import { serverLoad } from "@thomasfosterau/effect-sveltekit/server";
import { Effect } from "effect";

export const load = serverLoad((event) => Effect.succeed({ id: event.params.id }));
```

## Packages

| Package                                                            | What it is                                                                                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@thomasfosterau/effect-svelte`](packages/svelte/README.md)       | Ambient runtime and rune hooks (`useDerived`, `useQuery`, `useLiveStream`, atoms, …); no SvelteKit dependency                              |
| [`@thomasfosterau/effect-sveltekit`](packages/sveltekit/README.md) | Load / action / endpoint / hook wrappers, remote functions, client helpers, the `effectKit()` Vite plugin and an Effect deployment adapter |

## More

- Reference and recipes: [`docs/`](docs/) (start with [effect-svelte](docs/effect-svelte.md), [SvelteKit server](docs/sveltekit-server.md) and the [cookbook](docs/cookbook.md)).
- [Contributing](docs/CONTRIBUTING.md) · [Publishing](docs/PUBLISHING.md) · [Security](docs/SECURITY.md)

MIT © Thomas Foster
