import { Effect, Runtime, Fiber, Exit } from "effect";
import { getRuntime } from "./context.svelte.js";
import type { AsyncResult } from "./types.js";

/**
 * Re-run an effect whenever reactive dependencies change.
 * The function parameter is called inside $effect, so it automatically tracks dependencies.
 * When dependencies change, the previous fiber is interrupted and a new one starts.
 * 
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { derived } from '@thomasfosterau/effect-svelte';
 *   import { Effect } from 'effect';
 *   
 *   let userId = $state(1);
 *   
 *   const user = derived(() => 
 *     Effect.gen(function* () {
 *       const response = yield* fetchUser(userId);
 *       return response;
 *     })
 *   );
 * </script>
 * 
 * <button onclick={() => userId++}>Next User</button>
 * 
 * {#if user._tag === 'success'}
 *   <p>User: {user.value.name}</p>
 * {/if}
 * ```
 */
export function derived<A, E, R>(
  fn: () => Effect.Effect<A, E, R>
): AsyncResult<A, E> {
  const runtime = getRuntime() as Runtime.Runtime<R>;
  
  let result = $state<AsyncResult<A, E>>({ _tag: 'initial' });
  let currentFiber = $state<Fiber.RuntimeFiber<A, E> | null>(null);

  $effect(() => {
    // Interrupt previous fiber if it exists
    if (currentFiber !== null) {
      Runtime.runSync(runtime)(Fiber.interrupt(currentFiber));
    }

    // Get the effect (this tracks reactive dependencies)
    const effect = fn();

    // Set to pending state
    result = { _tag: 'pending' };

    // Run the effect and capture the fiber reference
    const runningFiber = Runtime.runFork(runtime)(effect);
    currentFiber = runningFiber;

    // Handle the result
    Runtime.runFork(runtime)(
      Effect.gen(function* () {
        const exit = yield* Fiber.await(runningFiber);
        
        // Only update result if this is still the current fiber
        if (currentFiber === runningFiber && Exit.isSuccess(exit)) {
          result = { _tag: 'success', value: exit.value };
        } else if (currentFiber === runningFiber && Exit.isFailure(exit)) {
          // Only update result if not interrupted (interruption is normal when deps change)
          if (!Exit.isInterrupted(exit)) {
            result = { _tag: 'failure', cause: exit.cause };
          }
        }
        
        // Clear fiber reference if this was the current one
        if (currentFiber === runningFiber) {
          currentFiber = null;
        }
      })
    );

    // Cleanup: interrupt the fiber when dependencies change or component unmounts
    return () => {
      if (currentFiber !== null) {
        Runtime.runSync(runtime)(Fiber.interrupt(currentFiber));
        currentFiber = null;
      }
    };
  });

  return result;
}
