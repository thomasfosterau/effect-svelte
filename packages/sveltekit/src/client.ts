/**
 * Client-only SvelteKit helpers for Effect integration.
 *
 * These run in the browser: Effect wrappers for `$app/navigation` and
 * `$app/state`, grouped into namespaces (`Navigation`, `State`, `Remote`),
 * plus the reactive `useRemoteQuery` hook.
 */

// Effect wrappers for $app/navigation: promise-returning helpers (goto,
// invalidate, ...) and lifecycle events (beforeNavigate/afterNavigate/onNavigate).
export * as Navigation from "./Navigation.js";

// Effect bridge for $app/state: the current page as a Stream of snapshots.
export * as State from "./State.js";

// Remote-function call helpers (callQuery, callCommand, liveQueryStream, ...).
export * as Remote from "./Remote.js";

// Reactive bridge: a remote query/resource as an AsyncResult.
export { useRemoteQuery } from "./remote-reactive.js";
