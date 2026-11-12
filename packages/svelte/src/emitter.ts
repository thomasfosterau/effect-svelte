import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

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
  readonly bufferSize?: number;
}

/** The default {@link SignalEmitterOptions.bufferSize}: the latest value only. */
const defaultBufferSize = 1;

/**
 * Normalises {@link SignalEmitterOptions.bufferSize} to a non-negative integer.
 * Throws a `RangeError` for a non-finite size.
 */
const normaliseBufferSize = (bufferSize: number): number => {
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
 *   import { Option, Stream } from 'effect';
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
 * <button onclick={() => count++}>{Option.getOrElse(doubled.latest, () => 0)}</button>
 * ```
 */
export class SignalEmitter<A> {
  private source: Stream.Stream<A>;
  /**
   * Delivers each value to every connected run. Allocated by the first run to
   * connect (inside that run's Effect, so the constructor runs nothing), then
   * never shut down: it lives as long as the emitter.
   */
  private pubsub: Option.Option<PubSub.PubSub<A>> = Option.none();
  /** Values emitted while no run is connected, oldest first. */
  private buffer: Array<A> = [];
  private bufferSize: number;
  /** How many runs are connected. */
  private connected = 0;

  constructor(options: SignalEmitterOptions = {}) {
    this.bufferSize = normaliseBufferSize(options.bufferSize ?? defaultBufferSize);
    // Subscribe first (the first run allocates the `PubSub`; the `onNone`
    // branch keeps whichever was stored first, so every run shares one), then
    // count this run as connected and take the buffer in one synchronous step.
    // A value emitted in between is buffered (no run was counted yet) and taken
    // with the rest; every later value is published to the subscription. So
    // nothing is lost, duplicated or reordered. Both are released when the
    // stream's scope closes; the count drops first, so from then on values are
    // buffered for the next run.
    this.source = Stream.unwrap(
      Effect.gen({ self: this }, function* () {
        const pubsub = yield* Option.match(this.pubsub, {
          onSome: Effect.succeed,
          onNone: () =>
            Effect.map(PubSub.unbounded<A>(), (fresh) => {
              // Another run may have stored its `PubSub` since the read above.
              const shared = Option.getOrElse(this.pubsub, () => fresh);
              this.pubsub = Option.some(shared);
              return shared;
            }),
        });
        const subscription = yield* PubSub.subscribe(pubsub);
        const buffered = yield* Effect.acquireRelease(
          Effect.sync(() => {
            this.connected += 1;
            return this.buffer.splice(0);
          }),
          () =>
            Effect.sync(() => {
              this.connected -= 1;
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
    // A connected run has allocated the `PubSub`.
    if (this.connected > 0 && Option.isSome(this.pubsub)) {
      PubSub.publishUnsafe(this.pubsub.value, value);
      return;
    }
    if (this.bufferSize <= 0) return;
    if (this.buffer.length >= this.bufferSize) this.buffer.shift();
    this.buffer.push(value);
  }

  /**
   * The Effect stream that emits values pushed via emit().
   * Can be used in Effect pipelines, composed with other streams, etc.
   * Never fails and does not end on its own.
   */
  get stream(): Stream.Stream<A> {
    return this.source;
  }
}
