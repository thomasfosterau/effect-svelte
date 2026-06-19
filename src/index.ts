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
 *   import { provideRuntime, derived, AsyncResult } from '@thomasfosterau/effect-svelte';
 *   import { Context, Effect } from 'effect';
 *
 *   // Provide runtime at app root
 *   provideRuntime(Context.empty());
 *
 *   // Use reactive effects
 *   let userId = $state(1);
 *   const user = derived(() => fetchUser(userId));
 * </script>
 *
 * {#if AsyncResult.isSuccess(user.current)}
 *   <p>{user.current.value.name}</p>
 * {/if}
 * ```
 */

// Export all Svelte helpers (and the re-exported AsyncResult namespace) from root
export * from "./svelte/index.js";
