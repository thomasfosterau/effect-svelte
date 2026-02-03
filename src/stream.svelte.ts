import { Stream, Runtime, Fiber, Exit, Effect, Chunk } from "effect";
import { getRuntime } from "./context.svelte.js";
import type { AsyncResult } from "./types.js";

export interface UseStreamReturn<A, E> {
  /**
   * The current result state of the stream
   */
  readonly result: AsyncResult<Chunk.Chunk<A>, E>;
  
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
 *   import { useStream } from 'effect-svelte';
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
export function useStream<A, E, R>(
  stream: Stream.Stream<A, E, R>
): UseStreamReturn<A, E> {
  const runtime = getRuntime<R>();
  
  let result = $state<AsyncResult<Chunk.Chunk<A>, E>>({ _tag: 'initial' });
  let values = $state<A[]>([]);
  let fiber = $state<Fiber.RuntimeFiber<void, E> | null>(null);

  $effect(() => {
    // Reset state
    result = { _tag: 'pending' };
    values = [];

    // Subscribe to the stream
    const subscription = Stream.runForEach(stream, (value) => 
      Effect.sync(() => {
        // Accumulate values efficiently
        values.push(value);
        
        // Update result with successful chunk so far
        result = { _tag: 'success', value: Chunk.fromIterable(values) };
      })
    );

    // Run the subscription as a fiber
    fiber = Runtime.runFork(runtime)(subscription);

    // Wait for completion and handle result
    Runtime.runFork(runtime)(
      Effect.gen(function* () {
        const exit = yield* Fiber.await(fiber!);
        
        if (Exit.isSuccess(exit)) {
          // Stream completed successfully
          result = { _tag: 'success', value: Chunk.fromIterable(values) };
        } else if (Exit.isFailure(exit)) {
          // Distinguish between interruption (normal cleanup) and actual failures
          if (!Exit.isInterrupted(exit)) {
            result = { _tag: 'failure', cause: exit.cause };
          } else {
            // Interrupted - keep the current success state with accumulated values
            if (values.length > 0) {
              result = { _tag: 'success', value: Chunk.fromIterable(values) };
            }
          }
        }
        
        fiber = null;
      })
    );

    // Cleanup: interrupt the subscription on unmount
    return () => {
      if (fiber !== null) {
        Runtime.runSync(runtime)(Fiber.interrupt(fiber));
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
    }
  };
}
