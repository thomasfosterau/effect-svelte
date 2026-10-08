import { Effect, type PubSub, Queue, Ref, Stream, SubscriptionRef } from "effect";
import { type Readable, readable } from "svelte/store";
import { interruptFiber, runFork, type RuntimeLike } from "./internal/run.js";

/**
 * Converts a Svelte [store](https://svelte.dev/docs/svelte/stores) (anything
 * implementing the readable store contract) into an Effect `Stream` that emits
 * the store's current value and every subsequent update.
 *
 * This is the Svelte→Effect counterpart to the `from*` helpers in this module
 * (which go Effect→Svelte): it lets store-based state — including third-party
 * libraries that expose Svelte stores — feed Effect pipelines. The subscription
 * is opened when the stream is run and closed when its scope closes (the
 * stream ends, e.g. via `Stream.take`, or its fiber is interrupted). The stream
 * never fails and does not end on its own.
 *
 * @example
 * ```ts
 * import { Store } from '@thomasfosterau/effect-svelte';
 * import { Stream } from 'effect';
 *
 * // `query` is a Svelte store from some library
 * const debounced = Store.toStream(query).pipe(
 *   Stream.debounce('300 millis'),
 * );
 * ```
 */
export function toStream<A>(store: Readable<A>): Stream.Stream<A> {
  // Effect v4's `Stream.callback` runs the returned Effect as the stream's
  // setup, inside the stream's scope; it is not a cleanup. Register the
  // unsubscribe as a finalizer on that scope instead.
  return Stream.callback<A>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() =>
        store.subscribe((value) => {
          Queue.offerUnsafe(queue, value);
        }),
      ),
      (unsubscribe) => Effect.sync(() => unsubscribe()),
    ),
  );
}

/**
 * Converts an Effect `Stream` into a Svelte
 * [readable store](https://svelte.dev/docs/svelte/stores), tracking the latest
 * emitted value. The given `initial` value is used until the stream emits.
 *
 * This is the base Effect→Svelte helper that the other `from*` functions build
 * on. Unlike the `useX` hooks, it takes an explicit `runtime` rather than
 * reading the Svelte context, so it can be called outside component
 * initialization (e.g. in module scope or a load function) and is
 * straightforward to test.
 *
 * The Effect fiber driving the store is forked lazily on the first subscription
 * and interrupted when the last subscriber unsubscribes, mirroring Svelte's
 * start/stop notifier semantics.
 *
 * @example
 * ```ts
 * import { Store } from '@thomasfosterau/effect-svelte';
 * import { Stream } from 'effect';
 *
 * const ticks = Store.fromStream(
 *   Stream.tick('1 second').pipe(Stream.scan(() => 0, (n) => n + 1)),
 *   0,
 *   runtime,
 * );
 * ```
 */
export function fromStream<A, E>(
  stream: Stream.Stream<A, E, never>,
  initial: A,
  runtime: RuntimeLike<never>,
): Readable<A> {
  return readable<A>(initial, (set) => {
    const fiber = runFork(runtime)(
      Stream.runForEach(stream, (value) => Effect.sync(() => set(value))),
    );
    return () => interruptFiber(fiber);
  });
}

/**
 * Converts an Effect `SubscriptionRef` into a Svelte
 * [readable store](https://svelte.dev/docs/svelte/stores), so Effect-managed
 * reactive state can be consumed anywhere a store is expected (including the
 * `$store` auto-subscription syntax in components, and store-based libraries).
 *
 * This is the Effect→Svelte counterpart to {@link toStream}. Like
 * {@link fromStream}, it takes an explicit `runtime` rather than reading the
 * Svelte context, so it can be called outside component initialization.
 *
 * The fiber driving the store is forked lazily on the first subscription and
 * interrupted when the last subscriber unsubscribes. Because
 * `SubscriptionRef.changes` re-emits the current value on subscribe,
 * subscribers receive the up-to-date value immediately; the ref's current value
 * is also used as the store's initial value for reads that occur before the
 * fiber has emitted.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { Store, getRuntime } from '@thomasfosterau/effect-svelte';
 *
 *   // Assume counterRef is a SubscriptionRef<number>
 *   const count = Store.fromSubscriptionRef(counterRef, getRuntime());
 * </script>
 *
 * <p>Count: {$count}</p>
 * ```
 */
export function fromSubscriptionRef<A>(
  ref: SubscriptionRef.SubscriptionRef<A>,
  runtime: RuntimeLike<never>,
): Readable<A> {
  // Read the current value synchronously so the store has a sensible initial
  // value before the fiber starts. `SubscriptionRef.changes` re-emits the
  // current value on subscribe, so no update is missed.
  const initial = SubscriptionRef.getUnsafe(ref);
  return fromStream(SubscriptionRef.changes(ref), initial, runtime);
}

/**
 * Converts an Effect `PubSub` into a Svelte
 * [readable store](https://svelte.dev/docs/svelte/stores) that tracks the most
 * recently published message. The given `initial` value is used until the
 * first message is published.
 *
 * A `PubSub` has no notion of a "current" value, so an explicit `initial` is
 * required; only messages published while the store has at least one subscriber
 * are observed. Built on {@link fromStream} via `Stream.fromPubSub`.
 *
 * @example
 * ```ts
 * import { Store } from '@thomasfosterau/effect-svelte';
 *
 * // Assume eventsPubSub is a PubSub<Event>
 * const latestEvent = Store.fromPubSub(eventsPubSub, null, runtime);
 * ```
 */
export function fromPubSub<A>(
  pubsub: PubSub.PubSub<A>,
  initial: A,
  runtime: RuntimeLike<never>,
): Readable<A> {
  return fromStream(Stream.fromPubSub(pubsub), initial, runtime);
}

/**
 * Converts an Effect `Queue` (its consumer/`Dequeue` side) into a Svelte
 * [readable store](https://svelte.dev/docs/svelte/stores) that tracks the most
 * recently taken value. The given `initial` value is used until the first value
 * is taken.
 *
 * A queue has no notion of a "current" value, so an explicit `initial` is
 * required. Built on {@link fromStream} via `Stream.fromQueue`, which takes from
 * the queue while the store has at least one subscriber and ends the stream
 * when the queue completes (`Cause.Done` is treated as end-of-stream and is
 * therefore excluded from the store's error channel).
 *
 * @example
 * ```ts
 * import { Store } from '@thomasfosterau/effect-svelte';
 *
 * // Assume workQueue is a Queue<Job>
 * const currentJob = Store.fromQueue(workQueue, null, runtime);
 * ```
 */
export function fromQueue<A, E>(
  queue: Queue.Dequeue<A, E>,
  initial: A,
  runtime: RuntimeLike<never>,
): Readable<A> {
  return fromStream(Stream.fromQueue(queue), initial, runtime);
}

/**
 * Reads the current value of an Effect `Ref` and exposes it as a Svelte
 * [readable store](https://svelte.dev/docs/svelte/stores).
 *
 * **Caveat — this is a static snapshot.** A plain `Ref` has no change
 * notifications, so the returned store reads the ref's value synchronously when
 * a subscriber first subscribes and never updates afterwards: later mutations
 * to the ref are *not* tracked. Two subscribers that subscribe at different
 * times may therefore observe different snapshots, and a single subscriber will
 * never see a value change.
 *
 * For a ref whose changes should be reflected reactively, use a
 * `SubscriptionRef` with {@link fromSubscriptionRef} instead.
 *
 * @example
 * ```ts
 * import { Store } from '@thomasfosterau/effect-svelte';
 *
 * // Assume configRef is a Ref<Config> — snapshot only, not reactive.
 * const config = Store.fromRef(configRef, runtime);
 * ```
 */
export function fromRef<A>(ref: Ref.Ref<A>, runtime: RuntimeLike<never>): Readable<A> {
  // A plain Ref offers no change feed, so we snapshot the value and never emit
  // again. `Ref.getUnsafe` reads synchronously without a fiber, so both the
  // `readable` initial value and the value re-read on subscribe come straight
  // from the ref; the `runtime` is accepted only for API symmetry with the
  // other `from*` helpers.
  void runtime;
  return readable<A>(Ref.getUnsafe(ref), (set) => {
    set(Ref.getUnsafe(ref));
  });
}
