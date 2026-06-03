/**
 * Universal SvelteKit helpers for Effect integration.
 * These helpers work on both client and server.
 *
 * For server-only helpers, import from '@thomasfosterau/effect-svelte/kit/server'
 * For client-only helpers, import from '@thomasfosterau/effect-svelte/kit/client'
 */

// Re-export universal helpers
export * from "./universal.js";
export * from "./remote-call.js";
export type { SvelteKitServices } from "./app-runtime.js";
