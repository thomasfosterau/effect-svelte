import { Effect, PubSub, Stream } from "effect";

/** Options for {@link SignalEmitter}. */
export interface SignalEmitterOptions {
  /**
   * How many values to keep while no run of the stream is connected; the next
   * run to connect receives them first. Once full, each new value drops the
   * oldest. Defaults to 1: only the latest value is kept, which suits an
   * emitter that bridges state. `0` drops values emitted while no run is
   * connected. A fractional size is rounded down and a negative one is treated
   * as `0`; a non-finite size (`NaN`, `Infinity`) makes the constructor throw a
   * `RangeError`. This limits only the buffer kept while no run is connected:
   * once a run is connected, values it has yet to take queue without bound.
   */
  readonly bufferSize?: number | undefined;
}

/** The default {@link SignalEmitterOptions.bufferSize}: the latest value only. */
const defaultBufferSize = 1;

/**
 * Normalises {@link SignalEmitterOptions.bufferSize} to a non-negative integer.
 * Throws a `RangeError` for a non-finite size.
 */
const normaliseBufferSize = (bufferSize: number | undefined): number => {
  if (bufferSize === undefined) return defaultBufferSize;
  if (!Number.isFinite(bufferSize)) {
    throw new RangeError(
      `SignalEmitter: bufferSize must be a finite number, received ${String(bufferSize)}`,
    );
  }
  return Math.max(0, Math.floor(bufferSize));
};

/**
 * A bridge that converts Svelte reactive state into Effect streams.
 * Use emit() to push values from Svelte's $effect, and consume via the stream property.
 *
 * Every run of `stream` that is connected receives every value emitted while
 * it is connected, so the stream can be run more than once at a time (for
 * example by two `useStream` consumers). A run connects when it starts and
 * disconnects when its scope closes (the stream ends or its fiber is
 * interrupted). Connecting is asynchronous, so values emitted while no run is
 * connected are buffered, by default only the latest one (see
 * {@link SignalEmitterOptions.bufferSize}), and delivered first to the next run
 * that connects. Only that run receives them; a run that connects while
 * another is already connected starts with the next emitted value. A connected
 * run that falls behind queues values without bound: `bufferSize` limits only
 * the buffer kept while no run is connected. The stream never fails and does
 * not end on its own.
 *
 * The constructor throws a `RangeError` if `bufferSize` is not finite.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { SignalEmitter, useStream } from '@thomasfosterau/effect-svelte';
 *   import { Stream } from 'effect';
 *
 *   let count = $state(0);
 *   const emitter = new SignalEmitter<number>();
 *
 *   // Runs before `useStream` connects; the emitter buffers the latest value.
 *   $effect(() => {
 *     emitter.emit(count);
 *   });
 *
 *   // emitter.stream can be used in any Effect pipeline.
 *   const doubled = useStream(emitter.stream.pipe(Stream.map((n) => n * 2)));
 * </script>
 *
 * <button onclick={() => count++}>{doubled.latest}</button>
 * ```
 */
export class SignalEmitter<A> {
  private _stream: Stream.Stream<A, never, never>;
  /** Delivers each value to every connected run. Never shut down: it lives as long as the emitter. */
  private _pubsub: PubSub.PubSub<A>;
  /** Values emitted while no run is connected, oldest first. */
  private _buffer: Array<A> = [];
  private _bufferSize: number;
  /** How many runs are connected. */
  private _connected = 0;

  constructor(options: SignalEmitterOptions = {}) {
    this._bufferSize = normaliseBufferSize(options.bufferSize);
    // `PubSub.unbounded` is pure allocation (an `Effect.sync`), so this
    // cannot suspend and needs no runtime.
    this._pubsub = Effect.runSync(PubSub.unbounded<A>());
    // Subscribe first, then count this run as connected and take the buffer in
    // one synchronous step. A value emitted in between is buffered (no run was
    // counted yet) and taken with the rest; every later value is published to
    // the subscription. So nothing is lost, duplicated or reordered. Both are
    // released when the stream's scope closes; the count drops first, so from
    // then on values are buffered for the next run.
    this._stream = Stream.unwrap(
      Effect.gen({ self: this }, function* () {
        const subscription = yield* PubSub.subscribe(this._pubsub);
        const buffered = yield* Effect.acquireRelease(
          Effect.sync(() => {
            this._connected += 1;
            return this._buffer.splice(0);
          }),
          () =>
            Effect.sync(() => {
              this._connected -= 1;
            }),
        );
        return Stream.concat(Stream.fromIterable(buffered), Stream.fromSubscription(subscription));
      }),
    );
  }

  /**
   * Emit a value into the stream: every connected run receives it, or, while
   * no run is connected, it is buffered for the next run.
   * This should typically be called from within a $effect to track reactive dependencies.
   * Synchronous, and needs no runtime.
   */
  emit(value: A): void {
    if (this._connected > 0) {
      PubSub.publishUnsafe(this._pubsub, value);
      return;
    }
    if (this._bufferSize <= 0) return;
    if (this._buffer.length >= this._bufferSize) this._buffer.shift();
    this._buffer.push(value);
  }

  /**
   * The Effect stream that emits values pushed via emit().
   * Can be used in Effect pipelines, composed with other streams, etc.
   * Never fails and does not end on its own.
   */
  get stream(): Stream.Stream<A, never, never> {
    return this._stream;
  }
}
