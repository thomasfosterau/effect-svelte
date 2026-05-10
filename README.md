# effect-svelte

Monorepo for Effect integrations with Svelte and SvelteKit.

## Packages

1. @thomasfosterau/effect-svelte
2. @thomasfosterau/effect-svelte-kit

## Installation

Install only what you need.

```bash
npm install @thomasfosterau/effect-svelte effect svelte
```

```bash
npm install @thomasfosterau/effect-svelte-kit effect @sveltejs/kit
```

If your app uses both APIs:

```bash
npm install @thomasfosterau/effect-svelte @thomasfosterau/effect-svelte-kit effect svelte @sveltejs/kit
```

## Usage

### Svelte runtime and hooks

```ts
import {
  provideRuntime,
  useEffect,
  derived,
} from "@thomasfosterau/effect-svelte";
```

### SvelteKit universal load

```ts
import { load } from "@thomasfosterau/effect-svelte-kit";
```

### SvelteKit server helpers

```ts
import {
  serverLoad,
  action,
  actions,
  handle,
  endpoint,
} from "@thomasfosterau/effect-svelte-kit/server";
```

### SvelteKit client helpers

```ts
import { placeholder } from "@thomasfosterau/effect-svelte-kit/client";
```

## Migration from previous single-package API

This split is a breaking change and does not include compatibility aliases.

| Old import                               | New import                               |
| ---------------------------------------- | ---------------------------------------- |
| @thomasfosterau/effect-svelte            | @thomasfosterau/effect-svelte            |
| @thomasfosterau/effect-svelte/kit        | @thomasfosterau/effect-svelte-kit        |
| @thomasfosterau/effect-svelte/kit/server | @thomasfosterau/effect-svelte-kit/server |
| @thomasfosterau/effect-svelte/kit/client | @thomasfosterau/effect-svelte-kit/client |

## Workspace development

### Install

```bash
bun install
```

### Build all packages

```bash
bun run build
```

### Build affected packages

```bash
bun run build:affected
```

### Typecheck all packages

```bash
bun run typecheck
```

### Typecheck affected packages

```bash
bun run typecheck:affected
```

### Clean all package outputs

```bash
bun run clean
```

Nx powers workspace orchestration. You can also run individual tasks directly:

```bash
bunx nx run effect-svelte:build
bunx nx run effect-svelte-kit:typecheck
```

Pull request CI uses Nx affected-target filtering. Pushes to main run full typecheck and build.

## Release workflow

Changesets is configured at the workspace root.

```bash
bun run changeset
bun run version
bun run release
```

Each package can be versioned independently.

## License

MIT
