# @thomasfosterau/effect-svelte-kit

SvelteKit integration helpers for Effect, with an optional Vite plugin that
lets route exports be Effects directly.

## Installation

```bash
npm install @thomasfosterau/effect-svelte-kit effect @sveltejs/kit
```

## Two ways to use it

### 1. Vite plugin (recommended)

Add the plugin to `vite.config.ts` before `sveltekit()`:

```ts
import { sveltekit } from "@sveltejs/kit/vite";
import { effectKit } from "@thomasfosterau/effect-svelte-kit/vite";

export default {
  plugins: [effectKit(), sveltekit()],
};
```

Then write Effects (or functions returning Effects) directly in any SvelteKit
route file:

```ts
// src/routes/+page.server.ts
import { Effect } from "effect";
import * as HttpClient from "@effect/platform/HttpClient";

export const load = (event) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.get(`https://api.example.com/${event.params.id}`);
    return { data: yield* response.json };
  });

export const actions = {
  create: (event) =>
    Effect.gen(function* () {
      const form = yield* Effect.promise(() => event.request.formData());
      return { ok: true, name: form.get("name") };
    }),
};
```

```ts
// src/routes/api/health/+server.ts
import { Effect } from "effect";
import { json } from "@sveltejs/kit";

export const GET = () => Effect.succeed(json({ status: "ok" }));
```

```ts
// src/hooks.server.ts
import { Effect } from "effect";

export const handle = ({ event, resolve }) =>
  Effect.gen(function* () {
    yield* Effect.log(`handling ${event.url.pathname}`);
    return yield* Effect.promise(() => resolve(event));
  });
```

Each export goes through the built-in `SvelteKitRuntime`, which provides
`HttpClient` (via the request's `fetch`) and `SvelteKitRequestEvent`. Plain
functions returning promises or values pass through unchanged.

#### Supported exports

| File                  | Exports auto-wrapped                                    |
| --------------------- | ------------------------------------------------------- |
| `+page.ts`            | `load`                                                  |
| `+page.server.ts`     | `load`, `actions`                                       |
| `+layout.ts`          | `load`                                                  |
| `+layout.server.ts`   | `load`                                                  |
| `+server.ts`          | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `HEAD`, `fallback` |
| `hooks.server.ts`     | `handle`, `handleFetch`, `handleError`, `init`          |
| `hooks.client.ts`     | `handleError`, `init`                                   |

Config exports like `prerender`, `ssr`, `csr`, and `trailingSlash` are never
touched.

#### Supported declaration forms

```ts
export const load = ...;
export let load = ...;
export var load = ...;
export function GET(event) { ... }
export async function POST(event) { ... }
```

`export { load }`, `export default`, and destructuring forms are not
transformed — use the explicit wrappers below if you need them.

#### Restricting which files are transformed

```ts
effectKit({ include: ["pageServer", "layoutServer", "server", "hooksServer"] });
```

### 2. Explicit wrappers

The original wrappers remain available and remain the right tool when you
want explicit control, are using an unsupported export form, or are not using
Vite at all.

```ts
import { load } from "@thomasfosterau/effect-svelte-kit";
import {
  serverLoad,
  action,
  actions,
  handle,
  endpoint,
} from "@thomasfosterau/effect-svelte-kit/server";
```

```ts
export const load = serverLoad((event) =>
  Effect.gen(function* () {
    return { data: 42 };
  })
);
```

See the repository root README for the full list.
