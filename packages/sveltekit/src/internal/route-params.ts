import type { RequestEvent } from "@sveltejs/kit";

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
