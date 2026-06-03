---
"@thomasfosterau/effect-svelte": minor
---

Add an app-wide Effect runtime and a dedicated Effect deployment adapter for SvelteKit.

**App-wide runtime** (`makeServerRuntime` / `makeUniversalRuntime`)

Define your application's Effect services as a single `Layer`, built once per
server process and shared across all requests:

```ts
// src/lib/server/runtime.ts
import { makeServerRuntime } from "@thomasfosterau/effect-svelte/kit/server";

export const runtime = makeServerRuntime(Database.Default);

// +page.server.ts
export const load = runtime.serverLoad((event) =>
  Effect.gen(function* () {
    const db = yield* Database;
    return { items: yield* db.listItems() };
  }),
);
```

The runtime exposes typed `serverLoad` / `action` / `actions` / `handle` /
`endpoint` wrappers, plus `runPromise`, `runPromiseExit`, and `dispose`. The
standalone wrappers now share a memoized runtime internally instead of
building a new `ManagedRuntime` on every request.

The `effectKit()` Vite plugin gained `serverRuntime` / `clientRuntime`
options so bare-Effect route exports resolve services from the same app-wide
runtime.

**Effect deployment adapter** (`@thomasfosterau/effect-svelte/kit/adapter`)

A SvelteKit adapter (like `@sveltejs/adapter-node`) whose production server
runs on `@effect/platform`'s `NodeHttpServer`: configuration via `Config`
(`PORT`, `HOST`, `ORIGIN`, proxy headers, ...), request tracing spans, and
graceful shutdown through Effect scopes.

```js
// svelte.config.js
import adapter from "@thomasfosterau/effect-svelte/kit/adapter";

export default { kit: { adapter: adapter() } };
```

The build emits `build/index.js` (run with `node build`) and
`build/handler.js`, which exports the whole SvelteKit app as a composable
Effect `HttpApp` for mounting inside an existing `@effect/platform` server.

`@effect/platform-node` is a new optional peer dependency, required only when
using the adapter.
