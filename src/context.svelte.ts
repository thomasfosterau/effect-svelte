import { getContext, setContext } from "svelte";
import type { Runtime } from "effect";

/**
 * Symbol key for storing the Effect runtime in Svelte context
 * Using a Symbol ensures no collisions with other context keys
 */
const RUNTIME_KEY = Symbol("effect-runtime");

/**
 * Sets the Effect runtime in the Svelte context.
 * This should be called at the root of your component tree.
 * 
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { provideRuntime } from 'effect-svelte';
 *   import { Runtime } from 'effect';
 *   
 *   provideRuntime(Runtime.defaultRuntime);
 * </script>
 * ```
 */
export function provideRuntime<R>(runtime: Runtime.Runtime<R>): void {
  setContext(RUNTIME_KEY, runtime);
}

/**
 * Retrieves the Effect runtime from Svelte context.
 * Must be called within a component that has a runtime provided by `provideRuntime`.
 * 
 * @throws {Error} If no runtime is found in context
 */
export function getRuntime<R>(): Runtime.Runtime<R> {
  const runtime = getContext<Runtime.Runtime<R> | undefined>(RUNTIME_KEY);
  
  if (!runtime) {
    throw new Error(
      "Effect runtime not found in context. " +
      "Make sure to call provideRuntime() in a parent component."
    );
  }
  
  return runtime;
}
