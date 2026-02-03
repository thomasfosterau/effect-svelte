/**
 * @thomasfosterau/effect-svelte
 * 
 * A library for seamless interoperation between Effect-TS, Svelte 5, and SvelteKit.
 * 
 * ## Exports
 * 
 * - **Svelte**: Effect-Svelte interoperability primitives for Svelte 5 runes
 * - **SvelteKit**: Effect adapters for SvelteKit (load functions, actions, endpoints, hooks)
 */

/**
 * Svelte namespace containing Effect-Svelte interoperability primitives.
 * Provides reactive hooks and utilities for integrating Effect-TS with Svelte 5 runes.
 * 
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { Svelte } from '@thomasfosterau/effect-svelte';
 *   import { Effect, Runtime } from 'effect';
 *   
 *   // Provide runtime at app root
 *   Svelte.provideRuntime(Runtime.defaultRuntime);
 *   
 *   // Use reactive effects
 *   let userId = $state(1);
 *   const user = Svelte.derived(() => fetchUser(userId));
 * </script>
 * ```
 */
export * as Svelte from "./svelte/index.js";

/**
 * SvelteKit namespace containing Effect adapters for SvelteKit.
 * Provides helpers for load functions, actions, endpoints, and hooks.
 * 
 * @example
 * ```ts
 * // src/routes/+page.server.ts
 * import { SvelteKit } from '@thomasfosterau/effect-svelte';
 * import { Effect } from 'effect';
 * 
 * export const load = SvelteKit.serverLoad((event) =>
 *   Effect.gen(function* () {
 *     const data = yield* fetchData();
 *     return { data };
 *   })
 * );
 * ```
 */
export { SvelteKit } from "./svelte-kit/index.js";

// Also export individual items for convenience
export * from "./svelte/index.js";
export type { AsyncResult } from "./svelte/types.js";

