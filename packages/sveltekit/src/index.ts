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

// Effect Schema ⇄ SvelteKit `transport` hook
export { transport, transporter } from "./transport.js";

// SvelteKit `$env` ⇄ Effect `Config`
export { sveltekitConfig, sveltekitConfigProvider } from "./config.js";
