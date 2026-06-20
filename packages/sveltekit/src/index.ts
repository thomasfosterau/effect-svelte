/**
 * Universal SvelteKit helpers for Effect integration.
 * These helpers work on both client and server.
 *
 * For server-only helpers, import from '@thomasfosterau/effect-sveltekit/server'
 * For client-only helpers, import from '@thomasfosterau/effect-sveltekit/client'
 */

// Re-export universal helpers
export * from "./universal.js";
export * as Remote from "./Remote.js";
export type { SvelteKitServices } from "./app-runtime.js";

// Effect wrappers for the universal hooks (`hooks.ts`): the `Hooks` namespace
// exposes `reroute` and the Effect Schema ⇄ `transport` helpers.
export * as Hooks from "./Hooks.js";

// SvelteKit `$env` ⇄ Effect `Config`
export { sveltekitConfig, sveltekitConfigProvider } from "./config.js";
