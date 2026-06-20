/**
 * Client-only SvelteKit helpers for Effect integration.
 *
 * These run in the browser: Effect wrappers for `$app/navigation`, plus the
 * universal remote-function call helpers (re-exported for convenience so client
 * code has a single import).
 */

// Effect wrappers for $app/navigation (goto, invalidate, preloadData, ...).
export * from "./navigation.js";

// $app/navigation lifecycle events (beforeNavigate/afterNavigate/onNavigate) as Effect Streams.
export * from "./navigation-events.js";

// Effect bridge for $app/state: the current page as a Stream of snapshots.
export * from "./app-state.js";

// Remote-function call helpers (callQuery, callCommand, liveQueryStream, ...).
export * from "./remote-call.js";

// Reactive bridge: a remote query/resource as an AsyncResult.
export { useRemoteQuery } from "./remote-reactive.js";
