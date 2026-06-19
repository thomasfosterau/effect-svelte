import { Effect, Fiber } from "effect";
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { getRuntime } from "./context.svelte.js";
import { interruptFiber, runFork, type RuntimeLike } from "./internal/run.js";
import { makeResult } from "./internal/result.svelte.js";

export interface DerivedReturn<A, E> {
  /**
   * The current result. While re-running after a dependency change, the
   * previous value is kept as a waiting `Success` (stale-while-revalidate).
   */
  readonly current: AsyncResult.AsyncResult<A, E>;
}

/**
 * Re-run an effect whenever reactive dependencies change.
 * The function parameter is called inside $effect, so it automatically tracks dependencies.
 * When dependencies change, the previous fiber is interrupted and a new one starts.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { derived, AsyncResult } from '@thomasfosterau/effect-svelte';
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
 * {#if AsyncResult.isSuccess(user.current)}
 *   <p>User: {user.current.value.name}</p>
 * {/if}
 * ```
 */
export function derived<A, E, R>(fn: () => Effect.Effect<A, E, R>): DerivedReturn<A, E> {
  const runtime = getRuntime() as RuntimeLike<R>;

  const state = makeResult<A, E>();
  let currentFiber: Fiber.Fiber<A, E> | null = null;

  $effect(() => {
    // Interrupt previous fiber if it exists
    if (currentFiber !== null) {
      interruptFiber(currentFiber);
    }

    // Get the effect (this tracks reactive dependencies)
    const effect = fn();

    // Mark as waiting, preserving the previous value if there is one.
    state.startWaiting();

    // Run the effect and capture the fiber reference
    const runningFiber = runFork(runtime)(effect);
    currentFiber = runningFiber;

    // Settle the result when the fiber completes, unless deps changed first.
    runFork(runtime)(
      Effect.gen(function* () {
        const exit = yield* Fiber.await(runningFiber);
        if (currentFiber === runningFiber) {
          state.settle(exit);
          currentFiber = null;
        }
      }),
    );

    // Cleanup: interrupt the fiber when dependencies change or component unmounts
    return () => {
      if (currentFiber !== null) {
        interruptFiber(currentFiber);
        currentFiber = null;
      }
    };
  });

  return {
    get current() {
      return state.current;
    },
  };
}
