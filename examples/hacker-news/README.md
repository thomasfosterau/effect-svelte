# Hacker News — effect-svelte /kit

A Hacker News reader (in the spirit of [HNPWA](https://hnpwa.com)) built with
SvelteKit, Effect, and
[`@thomasfosterau/effect-svelte/kit`](../../src/kit), backed by
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
| Plugin: bare-Effect `load`                    | `src/routes/[list=list]/[page]/+page.server.ts`                                                             |
| Plugin: Effect-returning `handle` hook        | `src/hooks.server.ts`                                                                                       |
| Plugin: plain-function pass-through           | `src/routes/+page.ts`                                                                                       |
| `serverLoad` (explicit wrapper)               | `src/routes/item/[id]/+page.server.ts`                                                                      |
| `load` (explicit universal wrapper)           | `src/routes/user/[name]/+page.ts`                                                                           |
| `actions` (explicit wrapper) + `fail()`       | `src/routes/search/+page.server.ts`                                                                         |
| `endpoint` (explicit wrapper)                 | `src/routes/api/[list=list]/+server.ts`                                                                     |
| `runWithSvelteKitRuntime` (manual)            | `src/routes/+layout.server.ts`                                                                              |
| `SvelteKitRequestEvent` service               | `src/routes/[list=list]/[page]/+page.server.ts`                                                             |
| `redirect()` / `error()` inside Effects       | `src/routes/+page.ts`, `item`, `user`, `api` routes                                                         |
| `RemoteFunction.query` / `.form` / `.command` | `src/routes/bookmarks/bookmarks.remote.ts`                                                                  |
| `callQuery` / `callCommand` / `submitForm`    | `src/routes/bookmarks/+page.svelte`                                                                         |
| `Schema.standardSchemaV1` input validation    | `src/routes/bookmarks/bookmarks.remote.ts`                                                                  |
| effect-svelte client hooks in SvelteKit       | `src/routes/+layout.svelte` (provideRuntime), `src/routes/bookmarks/+page.svelte` (`useQuery`, `useEffect`) |
| Effect service + Schema data layer            | `src/lib/hn/service.ts`, `src/lib/hn/schema.ts`                                                             |

## Plugin form vs. explicit wrappers

Both styles run through the same runtime; they differ in ergonomics:

- **Plugin form** (`/[list]/[page]`, `hooks.server.ts`): write `load`,
  `actions`, `GET`, `handle`, … as Effects (or functions returning Effects).
  Least ceremony, but SvelteKit's generated `$types` cannot see through the
  rewrite, so type the `data` prop in the page component yourself.
- **Explicit wrappers** (`/item/[id]`, `/user/[name]`, `/search`, `/api`):
  `serverLoad`, `load`, `actions`, `endpoint` return real SvelteKit
  functions, so route `$types` work as usual.

## Notes

- The story lists, item pages, and search hit the live Algolia API at request
  time; you need network access to browse the app.
- `/bookmarks` uses SvelteKit's experimental remote functions
  (`kit.experimental.remoteFunctions` in `svelte.config.js`). Bookmarks are
  stored in server memory and reset when the dev server restarts.
