import { Stream, Effect, Queue } from "effect";

/** The `emit()` handler while no run of the stream is connected: drops the value. */
const disconnected = (): void => {};

/**
 * A bridge that converts Svelte reactive state into Effect streams.
 * Use emit() to push values from Svelte's $effect, and consume via the stream property.
 *
 * `emit()` feeds the stream while it is running: it connects when the stream
 * starts and disconnects when the stream's scope closes (the stream ends or its
 * fiber is interrupted). Values emitted while no run is connected are dropped.
 * If the stream is run more than once at a time, `emit()` feeds only the most
 * recently started run, until that run ends. The stream never fails and does
 * not end on its own.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { SignalEmitter } from '@thomasfosterau/effect-svelte';
 *   import { Stream } from 'effect';
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
  private _emit: (value: A) => void = disconnected;

  constructor() {
    // Effect v4's `Stream.callback` runs the returned Effect as the stream's
    // setup, inside the stream's scope; it is not a cleanup. Connect `emit()`
    // to this run's queue, and disconnect it in a finalizer on that scope.
    this._stream = Stream.callback<A>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const emit = (value: A): void => {
            Queue.offerUnsafe(queue, value);
          };
          this._emit = emit;
          return emit;
        }),
        (emit) =>
          Effect.sync(() => {
            // Leave a newer run of the stream connected.
            if (this._emit === emit) this._emit = disconnected;
          }),
      ),
    );
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
