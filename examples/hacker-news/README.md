# Hacker News — effect-svelte /kit

A Hacker News reader (in the spirit of [HNPWA](https://hnpwa.com)) built with
SvelteKit, Effect, and
[`@thomasfosterau/effect-sveltekit`](../../packages/sveltekit), backed by
the [Algolia Hacker News API](https://hn.algolia.com/api).

Every route fetches data through Effect — via the `effectKit()` Vite plugin,
the explicit wrappers, or remote functions — so the example doubles as a tour
of the package's entire surface area.

## Run it

From the repository root:

```bash
pnpm install
pnpm run build           # build the package first (vp pack)
cd examples/hacker-news
pnpm run dev
```

## What it demonstrates

| API                                           | Where                                                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `effectKit()` Vite plugin                     | `vite.config.ts`                                                                                            |
| Plugin: `serverRuntime` (app-wide services)   | `vite.config.ts` → `src/lib/server/runtime.ts`                                                              |
| Plugin: bare-Effect `load`                    | `src/routes/[list=list]/[page]/+page.server.ts`                                                             |
| Plugin: Effect-returning `handle` hook        | `src/hooks.server.ts`                                                                                       |
| Plugin: plain-function pass-through           | `src/routes/+page.ts`                                                                                       |
| `makeServerRuntime` (app-wide runtime)        | `src/lib/server/runtime.ts`                                                                                 |
| App runtime `serverLoad` wrapper              | `src/routes/item/[id]/+page.server.ts`                                                                      |
| App runtime `actions` wrapper + `fail()`      | `src/routes/search/+page.server.ts`                                                                         |
| App runtime `endpoint` wrapper                | `src/routes/api/[list=list]/+server.ts`                                                                     |
| `effectAdapter` (Effect deployment adapter)   | `svelte.config.js`; run the production build with `node build`                                              |
| `load` (explicit universal wrapper)           | `src/routes/user/[name]/+page.ts`                                                                           |
| `runWithSvelteKitRuntime` (manual)            | `src/routes/+layout.server.ts`                                                                              |
| `SvelteKitRequestEvent` service               | `src/routes/[list=list]/[page]/+page.server.ts`                                                             |
| `redirect()` / `error()` inside Effects       | `src/routes/+page.ts`, `item`, `user`, `api` routes                                                         |
| `RemoteFunction.query` / `.form` / `.command` | `src/routes/bookmarks/bookmarks.remote.ts`                                                                  |
| `callQuery` / `callCommand` / `submitForm`    | `src/routes/bookmarks/+page.svelte`                                                                         |
| `Schema.toStandardSchemaV1` input validation  | `src/routes/bookmarks/bookmarks.remote.ts`                                                                  |
| effect-svelte client hooks in SvelteKit       | `src/routes/+layout.svelte` (provideRuntime), `src/routes/bookmarks/+page.svelte` (`useQuery`, `useEffect`) |
| Effect service + Schema data layer            | `src/lib/hn/service.ts`, `src/lib/hn/schema.ts`                                                             |

## The app-wide runtime

`src/lib/server/runtime.ts` defines the application's services (`HackerNews`,
`Bookmarks`) as one layer with `makeServerRuntime`. The layer is built once
per server process and shared by every request:

- Routes using explicit wrappers import `runtime` and call
  `runtime.serverLoad(...)` / `runtime.actions(...)` / `runtime.endpoint(...)`.
- Routes that export bare Effects get the same services through the
  `effectKit({ serverRuntime: "$lib/server/runtime" })` plugin option.

## Plugin form vs. explicit wrappers

Both styles run through the same runtime; they differ in ergonomics:

- **Plugin form** (`/[list]/[page]`, `hooks.server.ts`): write `load`,
  `actions`, `GET`, `handle`, … as Effects (or functions returning Effects).
  Least ceremony, but SvelteKit's generated `$types` cannot see through the
  rewrite, so type the `data` prop in the page component yourself.
- **Explicit wrappers** (`/item/[id]`, `/user/[name]`, `/search`, `/api`):
  `runtime.serverLoad`, `load`, `runtime.actions`, `runtime.endpoint` return
  real SvelteKit functions, so route `$types` work as usual.

## Production build (Effect adapter)

`svelte.config.js` uses the Effect deployment adapter. `pnpm run build`
produces a `build/` directory whose server runs on Effect's
`NodeHttpServer` (from `effect/unstable/http`):

```bash
pnpm run build
node build            # or: pnpm run preview
# PORT=8080 ORIGIN=https://example.com node build
```

`build/handler.js` also exports the whole app as a composable Effect
`HttpApp` for mounting inside an existing Effect HTTP server.

## Notes

- The story lists, item pages, and search hit the live Algolia API at request
  time; you need network access to browse the app.
- `/bookmarks` uses SvelteKit's experimental remote functions
  (`kit.experimental.remoteFunctions` in `svelte.config.js`). Bookmarks are
  stored in server memory and reset when the dev server restarts.
