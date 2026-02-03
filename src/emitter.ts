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

  constructor() {
    // Use Stream.async to create a stream with a push-based API
    this._stream = Stream.async<A>((emit) => {
      let isDone = false;

      // Set up the emit function to immediately emit values
      this._emit = (value: A) => {
        if (!isDone) {
          emit.single(value);
        }
      };

      // Return cleanup function
      return Effect.sync(() => {
        isDone = true;
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
