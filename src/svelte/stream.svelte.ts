import { Cause, Stream, Fiber, Exit, Effect } from "effect";
import { getRuntime } from "./context.svelte.js";
import { interruptFiber, runFork, type RuntimeLike } from "./internal/run.js";
import type { AsyncResult } from "./types.js";

export interface UseStreamReturn<A, E> {
  /**
   * The current result state of the stream
   */
  readonly result: AsyncResult<ReadonlyArray<A>, E>;

  /**
   * All values emitted by the stream so far
   */
  readonly values: ReadonlyArray<A>;

  /**
   * The most recent value emitted by the stream (undefined if none)
   */
  readonly latest: A | undefined;
}

/**
 * Subscribe to a Stream and collect emissions.
 * The stream starts on component mount and is interrupted on unmount.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useStream } from '@thomasfosterau/effect-svelte';
 *   import { Stream, Schedule } from 'effect';
 *
 *   const counter = useStream(
 *     Stream.iterate(0, n => n + 1).pipe(
 *       Stream.schedule(Schedule.spaced('1 second'))
 *     )
 *   );
 * </script>
 *
 * <p>Latest: {counter.latest}</p>
 * <p>All values: {counter.values.join(', ')}</p>
 * ```
 */
export function useStream<A, E, R>(stream: Stream.Stream<A, E, R>): UseStreamReturn<A, E> {
  const runtime = getRuntime() as RuntimeLike<R>;

  let result = $state<AsyncResult<ReadonlyArray<A>, E>>({ _tag: "initial" });
  let values = $state<A[]>([]);
  let fiber: Fiber.Fiber<void, E> | null = null;

  $effect(() => {
    // Reset state
    result = { _tag: "pending" };
    values = [];

    // Subscribe to the stream
    const subscription = Stream.runForEach(stream, (value) =>
      Effect.sync(() => {
        // Accumulate values with reassignment for Svelte reactivity
        values = [...values, value];

        // Update result state without creating Chunk on each emission
        result = { _tag: "success", value: values };
      }),
    );

    // Run the subscription as a fiber and capture the reference
    const runningFiber = runFork(runtime)(subscription);
    fiber = runningFiber;

    // Wait for completion and handle result
    runFork(runtime)(
      Effect.gen(function* () {
        const exit = yield* Fiber.await(runningFiber);

        // Only update if this is still the current fiber
        if (fiber === runningFiber) {
          if (Exit.isSuccess(exit)) {
            // Stream completed successfully - use current values
            result = { _tag: "success", value: values };
          } else if (Exit.isFailure(exit)) {
            // Distinguish between interruption (normal cleanup) and actual failures
            if (!Cause.hasInterrupts(exit.cause)) {
              result = { _tag: "failure", cause: exit.cause };
            } else {
              // Interrupted - keep the current success state with accumulated values
              if (values.length > 0) {
                result = { _tag: "success", value: values };
              }
            }
          }

          fiber = null;
        }
      }),
    );

    // Cleanup: interrupt the subscription on unmount
    return () => {
      if (fiber !== null) {
        interruptFiber(fiber);
        fiber = null;
      }
    };
  });

  return {
    get result() {
      return result;
    },
    get values() {
      return values;
    },
    get latest() {
      return values.length > 0 ? values[values.length - 1] : undefined;
    },
  };
}
