/**
 * @thomasfosterau/effect-svelte
 * 
 * Effect-Svelte interoperability primitives for Svelte 5 runes.
 * Provides reactive hooks and utilities for integrating Effect-TS with Svelte 5.
 * 
 * For SvelteKit helpers, import from:
 * - `@thomasfosterau/effect-svelte/kit` - Universal helpers
 * - `@thomasfosterau/effect-svelte/kit/server` - Server-only helpers
 * - `@thomasfosterau/effect-svelte/kit/client` - Client-only helpers
 * 
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { provideRuntime, derived } from '@thomasfosterau/effect-svelte';
 *   import { Effect, Runtime } from 'effect';
 *   
 *   // Provide runtime at app root
 *   provideRuntime(Runtime.defaultRuntime);
 *   
 *   // Use reactive effects
 *   let userId = $state(1);
 *   const user = derived(() => fetchUser(userId));
 * </script>
 * ```
 */

// Export all Svelte helpers from root
export * from "./svelte/index.js";
export type { AsyncResult } from "./svelte/types.js";

