import { createContext } from "svelte";
import type { Runtime } from "effect";
import { defaultSvelteRuntime } from "./runtime.js";

/**
 * Type-safe context for Effect runtime management.
 * Uses Svelte 5's createContext API for better type safety and developer experience.
 * 
 * The runtime is typed to support any environment type, allowing users to provide
 * runtimes with specific service requirements. However, users must ensure their
 * runtime provides all required services for the effects they run.
 */
const [getRuntime, provideRuntimeInternal] = createContext<Runtime.Runtime<never>>();

/**
 * Retrieves the Effect runtime from Svelte context.
 * 
 * @returns The runtime provided via provideRuntime
 * @throws Will throw if called outside of a component with a provided runtime
 */
function getRuntimeContext(): Runtime.Runtime<never> {
  const runtime = getRuntime();
  if (runtime === undefined) {
    throw new Error(
      "effect-svelte: No Effect runtime found in context. " +
      "Make sure you have called provideRuntime() in a parent component."
    );
  }
  return runtime;
}

/**
 * Provides an Effect runtime to the Svelte context tree.
 * This should be called at the root of your component tree, typically in your root layout.
 * 
 * The default runtime (SvelteRuntime.defaultRuntime) is recommended for most applications.
 * For applications requiring custom services, extend the runtime using SvelteRuntime.extend().
 * 
 * @param runtime - The Effect runtime to provide. Defaults to SvelteRuntime.defaultRuntime
 * 
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { provideRuntime, SvelteRuntime } from '@thomasfosterau/effect-svelte';
 *   
 *   // Use default runtime
 *   provideRuntime();
 *   
 *   // Or provide a custom runtime
 *   const customRuntime = SvelteRuntime.extend(myCustomLayer);
 *   provideRuntime(customRuntime);
 * </script>
 * ```
 */
function provideRuntime<R = never>(
  runtime: Runtime.Runtime<R> = defaultSvelteRuntime as unknown as Runtime.Runtime<R>
): void {
  provideRuntimeInternal(runtime as Runtime.Runtime<never>);
}

export { getRuntimeContext as getRuntime, provideRuntime };

