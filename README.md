# effect-svelte

Two packages, `@thomasfosterau/effect-svelte` and `@thomasfosterau/effect-sveltekit`, for using [Effect](https://effect.website) v4 within Svelte 5 components and SvelteKit applications.

**Disclaimer:** This repository has almost entirely been created using Claude Code and extracts a bunch of utilities I've written for my own (private) projects. Expect the API to churn based on what I need for my own projects before there is a v1.0 release. I let Claude open its own issues and PRs here, so they’re not necessarily written by me.

| Package                                                                                              | What it is                                                                                                                                                                                                 | Docs                                   |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| [`@thomasfosterau/effect-svelte`](https://www.npmjs.com/package/@thomasfosterau/effect-svelte)       | Effect integration for Svelte 5 runes: an ambient runtime and rune hooks (`useDerived`, `useQuery`, `useMutation`, `useLiveStream`, …) exposing `AsyncResult` through `.current`. Works in any Svelte app. | [README](packages/svelte/README.md)    |
| [`@thomasfosterau/effect-sveltekit`](https://www.npmjs.com/package/@thomasfosterau/effect-sveltekit) | SvelteKit integration: load / action / endpoint / hook wrappers, remote functions, the `effectKit()` Vite plugin and an Effect deployment adapter.                                                         | [README](packages/sveltekit/README.md) |

## Install

To just use the plain Svelte package:

```bash
pnpm add @thomasfosterau/effect-svelte effect svelte
```

To use both the Svelte and SvelteKit packages:

```bash
pnpm add @thomasfosterau/effect-svelte @thomasfosterau/effect-sveltekit effect svelte @sveltejs/kit
```

`effect` (`>=4.0.2`) is a peer: keep a single copy of it in your app.

## Example

Run an Effect from a component and render its `AsyncResult`:

```svelte
<script lang="ts">
  import { provideRuntime, useDerived, AsyncResult } from "@thomasfosterau/effect-svelte";
  import { Effect } from "effect";

  provideRuntime();

  let userId = $state(1);
  const user = useDerived(() =>
    Effect.succeed({ id: userId, name: `User ${userId}` }).pipe(Effect.delay("200 millis")),
  );
</script>

<button onclick={() => userId++}>Next</button>

{#if AsyncResult.isSuccess(user.current)}
  <p>{user.current.value.name}</p>
{/if}
```

Or return an Effect from a SvelteKit `load`:

```ts
// src/routes/items/[id]/+page.server.ts
import { serverLoad } from "@thomasfosterau/effect-sveltekit/server";
import { Effect } from "effect";

export const load = serverLoad((event) => Effect.succeed({ id: event.params.id }));
```

More recipes are in the [cookbook](docs/cookbook.md).

## License

MIT

## Contributing

Setup, hooks and individual checks are in [CONTRIBUTING.md](./CONTRIBUTING.md); conventions for humans and agents in [AGENTS.md](./AGENTS.md). Releases are automated with Changesets and npm trusted publishing (OIDC); see [PUBLISHING.md](./PUBLISHING.md). Report vulnerabilities as described in [SECURITY.md](./SECURITY.md).
