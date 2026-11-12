import type { LoadEvent, RequestEvent } from "@sveltejs/kit";

/**
 * The route-parameter constraint SvelteKit uses for its own handler types
 * (`RequestEvent`, `ServerLoad`, `Load`, `Action`, `RequestHandler`) — the
 * generated `LayoutParams<'/'>`. For a root `+layout`, whose params span the
 * whole route tree, this is a *partial* record (e.g. `{ type?: string; id?:
 * string }`); for a concrete route it is the exact params (e.g. `{ id: string }`).
 *
 * The package's wrappers mirror this base (rather than hardcoding
 * `Record<string, string>`) so they are never more restrictive than SvelteKit's
 * own handlers. In particular, a partial-param root `+layout.server.ts` can carry
 * an explicit `: LayoutServerLoad` annotation without the wrapper rejecting it.
 *
 * In a SvelteKit project this resolves to the generated `$app/types` params; in a
 * bare type-check (no generated types) it falls back to `Record<string, string>`,
 * exactly as SvelteKit's own `AppLayoutParams<'/'>` does.
 */
export type SvelteRouteParams = RequestEvent["params"];

/**
 * The route-id constraint SvelteKit uses for its own handler types — the type
 * of `event.route.id`: the app's generated route ids (`string` in a bare
 * type-check), or SvelteKit's "no route matched" value.
 *
 * Named from its owner rather than restated, so the wrappers' `RouteId`
 * parameters always accept exactly what `RequestEvent<Params, RouteId>`,
 * `ServerLoad`, `Action` and `Load` accept.
 */
export type SvelteRouteId = RequestEvent["route"]["id"];

/**
 * The constraint on a universal `load`'s input `data` (what the route's server
 * `load` returned) — the type of SvelteKit's `LoadEvent["data"]`, which also
 * admits SvelteKit's "no server load" value.
 */
export type SvelteLoadInputData = LoadEvent["data"];
