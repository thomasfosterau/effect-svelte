import { Effect, Runtime, Fiber, Exit } from "effect";
import { getRuntime } from "./context.svelte.js";
import type { AsyncResult } from "./types.js";

export interface UseEffectOptions {
  /**
   * If true, the effect will run immediately on mount.
   * If false, the effect will only run when manually triggered via run().
   * @default false
   */
  immediate?: boolean;
}

export interface UseEffectReturn<A, E> {
  /**
   * The current result state of the effect
   */
  readonly result: AsyncResult<A, E>;
  
  /**
   * Manually trigger execution of the effect
   */
  run: () => void;
  
  /**
   * Interrupt the currently running effect
   */
  interrupt: () => void;
}

/**
 * Run a single Effect and track its result state.
 * 
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useEffect } from 'effect-svelte';
 *   import { Effect } from 'effect';
 *   
 *   const fetchData = useEffect(
 *     Effect.delay(Effect.succeed(42), '1 second'),
 *     { immediate: true }
 *   );
 * </script>
 * 
 * {#if fetchData.result._tag === 'success'}
 *   <p>Result: {fetchData.result.value}</p>
 * {/if}
 * ```
 */
export function useEffect<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options: UseEffectOptions = {}
): UseEffectReturn<A, E> {
  const { immediate = false } = options;
  const runtime = getRuntime<R>();
  
  let result = $state<AsyncResult<A, E>>({ _tag: 'initial' });
  let currentFiber = $state<Fiber.RuntimeFiber<A, E> | null>(null);

  const run = () => {
    // Interrupt any existing fiber
    if (currentFiber !== null) {
      Runtime.runSync(runtime)(Fiber.interrupt(currentFiber));
    }

    // Set to pending state
    result = { _tag: 'pending' };

    // Run the effect
    currentFiber = Runtime.runFork(runtime)(effect);

    // Handle the result
    Runtime.runFork(runtime)(
      Effect.gen(function* () {
        const exit = yield* Fiber.await(currentFiber!);
        
        // Only update result if this is still the current fiber
        // (it might have been interrupted by a new run)
        if (currentFiber && Exit.isSuccess(exit)) {
          result = { _tag: 'success', value: exit.value };
        } else if (currentFiber && Exit.isFailure(exit)) {
          // Check if it was interrupted (normal cleanup) vs actual failure
          if (!Exit.isInterrupted(exit)) {
            result = { _tag: 'failure', cause: exit.cause };
          }
        }
        
        // Clear fiber reference if this was the current one
        if (currentFiber) {
          currentFiber = null;
        }
      })
    );
  };

  const interrupt = () => {
    if (currentFiber !== null) {
      Runtime.runSync(runtime)(Fiber.interrupt(currentFiber));
      currentFiber = null;
    }
  };

  // Set up effect lifecycle
  $effect(() => {
    if (immediate) {
      run();
    }

    // Cleanup: interrupt any running fiber on unmount
    return () => {
      interrupt();
    };
  });

  return {
    get result() {
      return result;
    },
    run,
    interrupt
  };
}
