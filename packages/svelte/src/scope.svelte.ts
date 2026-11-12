import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import { untrack } from "svelte";
import { runSyncDefault } from "./internal/run.js";

/**
 * What {@link useScope} returns: the component's scope, read through
 * `current`, which is `None` until the component mounts and the scope exists,
 * then `Some` with the scope.
 */
export interface ScopeRef {
  /** The component's scope: `None` before mount (and during SSR), `Some` once it exists. */
  readonly current: Option.Option<Scope.Closeable>;
}

/**
 * Creates an Effect Scope that is tied to the component lifecycle.
 * The scope is created when the component mounts and closed when it unmounts.
 *
 * Note: Due to Svelte's initialization order ($effect runs after mount),
 * `current` is `None` initially. Use the callback-based approach for
 * guaranteed availability.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useScope } from 'effect-svelte';
 *   import { Option } from 'effect';
 *
 *   const scope = useScope();
 *
 *   $effect(() => {
 *     if (Option.isSome(scope.current)) {
 *       // Use scope.current.value here
 *     }
 *   });
 * </script>
 * ```
 */
export function useScope(): ScopeRef {
  let scope = $state.raw<Option.Option<Scope.Closeable>>(Option.none());

  $effect(() => {
    // Create the scope when component mounts
    const made = Scope.makeUnsafe();
    scope = Option.some(made);

    // Clean up: close the scope when component unmounts
    return () => {
      runSyncDefault(Scope.close(made, Exit.void));
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
    const scope = Scope.makeUnsafe();

    // Execute the callback with the scope. The callback runs untracked so
    // that reactive state it touches does not become a dependency of this
    // effect — the callback is a once-per-mount setup, not a reactive one.
    const cleanup = untrack(() => callback(scope));

    // Clean up
    return () => {
      // Call user's cleanup if provided
      if (P.isFunction(cleanup)) {
        cleanup();
      }

      // Close the scope
      runSyncDefault(Scope.close(scope, Exit.void));
    };
  });
}
