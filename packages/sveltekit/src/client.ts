/**
 * Client-only SvelteKit helpers for Effect integration.
 *
 * These run in the browser: Effect wrappers for `$app/navigation`, plus the
 * universal remote-function call helpers (re-exported for convenience so client
 * code has a single import).
 */

// Effect wrappers for $app/navigation (goto, invalidate, preloadData, ...).
export * from "./navigation.js";

// Remote-function call helpers (callQuery, callCommand, liveQueryStream, ...).
export * from "./remote-call.js";
