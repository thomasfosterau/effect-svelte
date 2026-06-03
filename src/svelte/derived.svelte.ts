import { Effect, Fiber, Exit } from "effect";
import { getRuntime } from "./context.svelte.js";
import { interruptFiber, runFork, type RuntimeLike } from "./internal/run.js";
import { assignResult } from "./internal/result.js";
import type { AsyncResult } from "./types.js";

/**
 * Re-run an effect whenever reactive dependencies change.
 * The function parameter is called inside $effect, so it automatically tracks dependencies.
 * When dependencies change, the previous fiber is interrupted and a new one starts.
 *
 * The returned AsyncResult is a reactive object whose state transitions in place,
 * so it can be used directly in templates.
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
export function derived<A, E, R>(fn: () => Effect.Effect<A, E, R>): AsyncResult<A, E> {
  const runtime = getRuntime() as RuntimeLike<R>;

  // The result is updated by mutating this object in place (never reassigning),
  // so the reference returned to the caller stays reactive.
  const result = $state<Record<string, unknown>>({ _tag: "initial" });
  let currentFiber: Fiber.RuntimeFiber<A, E> | null = null;

  $effect(() => {
    // Interrupt previous fiber if it exists
    if (currentFiber !== null) {
      interruptFiber(currentFiber);
    }

    // Get the effect (this tracks reactive dependencies)
    const effect = fn();

    // Set to pending state
    assignResult(result, { _tag: "pending" });

    // Run the effect and capture the fiber reference
    const runningFiber = runFork(runtime)(effect);
    currentFiber = runningFiber;

    // Handle the result
    runFork(runtime)(
      Effect.gen(function* () {
        const exit = yield* Fiber.await(runningFiber);

        // Only update result if this is still the current fiber
        if (currentFiber === runningFiber && Exit.isSuccess(exit)) {
          assignResult(result, { _tag: "success", value: exit.value });
        } else if (currentFiber === runningFiber && Exit.isFailure(exit)) {
          // Only update result if not interrupted (interruption is normal when deps change)
          if (!Exit.isInterrupted(exit)) {
            assignResult(result, { _tag: "failure", cause: exit.cause });
          }
        }

        // Clear fiber reference if this was the current one
        if (currentFiber === runningFiber) {
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

  return result as AsyncResult<A, E>;
}
