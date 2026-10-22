import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import * as Effect from "effect/Effect";
import { untrack } from "svelte";

/**
 * Creates an Effect Scope that is tied to the component lifecycle.
 * The scope is created when the component mounts and closed when it unmounts.
 *
 * Note: Due to Svelte's initialization order ($effect runs after mount),
 * the scope will be null initially. Use the callback-based approach for
 * guaranteed availability.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useScope } from 'effect-svelte';
 *
 *   const scope = useScope();
 *
 *   $effect(() => {
 *     if (scope.current) {
 *       // Use scope.current here
 *     }
 *   });
 * </script>
 * ```
 */
export function useScope(): { get current(): Scope.Closeable | null } {
  let scope = $state<Scope.Closeable | null>(null);

  $effect(() => {
    // Create the scope when component mounts
    scope = Effect.runSync(Scope.make());

    // Clean up: close the scope when component unmounts
    return () => {
      if (scope) {
        Effect.runSync(Scope.close(scope, Exit.void));
      }
    };
  });

  return {
    get current() {
      return scope;
    },
  };
}

/**
 * Callback-based variant of useScope that guarantees scope availability.
 * The callback is executed once the scope is created and receives the scope as parameter.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useScopeCallback } from 'effect-svelte';
 *
 *   useScopeCallback((scope) => {
 *     // Scope is guaranteed to be available here
 *     // Set up any scope-dependent resources
 *   });
 * </script>
 * ```
 */
export function useScopeCallback(callback: (scope: Scope.Closeable) => void | (() => void)): void {
  $effect(() => {
    // Create the scope when component mounts
    const scope = Effect.runSync(Scope.make());

    // Execute the callback with the scope. The callback runs untracked so
    // that reactive state it touches does not become a dependency of this
    // effect — the callback is a once-per-mount setup, not a reactive one.
    const cleanup = untrack(() => callback(scope));

    // Clean up
    return () => {
      // Call user's cleanup if provided
      if (typeof cleanup === "function") {
        cleanup();
      }

      // Close the scope
      Effect.runSync(Scope.close(scope, Exit.void));
    };
  });
}
