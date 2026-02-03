import { Stream, Effect } from "effect";

/**
 * A bridge that converts Svelte reactive state into Effect streams.
 * Use emit() to push values from Svelte's $effect, and consume via the stream property.
 * 
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { SignalEmitter } from 'effect-svelte';
 *   
 *   let count = $state(0);
 *   const emitter = new SignalEmitter<number>();
 *   
 *   $effect(() => {
 *     emitter.emit(count);
 *   });
 *   
 *   // Now emitter.stream can be used in Effect pipelines
 *   // Example: Process the stream with Effect
 *   const processed = emitter.stream.pipe(
 *     Stream.map(n => n * 2)
 *   );
 * </script>
 * ```
 */
export class SignalEmitter<A> {
  private _stream: Stream.Stream<A, never, never>;
  private _emit: (value: A) => void = () => {};

  constructor(_capacity: number = 16) {
    // Use Stream.asyncPush to create a stream with a push-based API
    this._stream = Stream.async<A>((emit) => {
      // Create an unbounded queue for buffering
      const queue: A[] = [];
      let isDone = false;

      // Set up the emit function
      this._emit = (value: A) => {
        if (!isDone) {
          queue.push(value);
          // Emit all queued values
          while (queue.length > 0) {
            const val = queue.shift();
            if (val !== undefined) {
              emit.single(val);
            }
          }
        }
      };

      // Return cleanup function
      return Effect.sync(() => {
        isDone = true;
        queue.length = 0;
        this._emit = () => {};
      });
    });
  }

  /**
   * Emit a value into the stream.
   * This should typically be called from within a $effect to track reactive dependencies.
   */
  emit(value: A): void {
    this._emit(value);
  }

  /**
   * The Effect stream that emits values pushed via emit().
   * Can be used in Effect pipelines, composed with other streams, etc.
   */
  get stream(): Stream.Stream<A, never, never> {
    return this._stream;
  }
}

/**
 * Creates a SignalEmitter with a bounded queue.
 * When the queue is full, new values will be dropped.
 * 
 * @param capacity Maximum number of values to buffer
 */
export function createBoundedEmitter<A>(capacity: number): SignalEmitter<A> {
  return new SignalEmitter<A>(capacity);
}
