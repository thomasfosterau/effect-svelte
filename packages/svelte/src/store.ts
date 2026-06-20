import { Effect, Queue, Stream, SubscriptionRef } from "effect";
import { type Readable, readable } from "svelte/store";
import { interruptFiber, runFork, type RuntimeLike } from "./internal/run.js";

/**
 * Converts a Svelte [store](https://svelte.dev/docs/svelte/stores) (anything
 * implementing the readable store contract) into an Effect `Stream` that emits
 * the store's current value and every subsequent update.
 *
 * This is the Svelte→Effect counterpart to `useSubscriptionRef` /
 * `useStream` (which go Effect→Svelte): it lets store-based state — including
 * third-party libraries that expose Svelte stores — feed Effect pipelines. The
 * subscription is opened when the stream is run and closed when its scope
 * closes.
 *
 * @example
 * ```ts
 * import { streamFromStore } from '@thomasfosterau/effect-svelte';
 * import { Stream } from 'effect';
 *
 * // `query` is a Svelte store from some library
 * const debounced = streamFromStore(query).pipe(
 *   Stream.debounce('300 millis'),
 * );
 * ```
 */
export function streamFromStore<A>(store: Readable<A>): Stream.Stream<A> {
  return Stream.callback<A>((queue) => {
    const unsubscribe = store.subscribe((value) => {
      Queue.offerUnsafe(queue, value);
    });
    return Effect.sync(() => unsubscribe());
  });
}

/**
 * Converts an Effect `SubscriptionRef` into a Svelte
 * [readable store](https://svelte.dev/docs/svelte/stores), so Effect-managed
 * reactive state can be consumed anywhere a store is expected (including the
 * `$store` auto-subscription syntax in components, and store-based libraries).
 *
 * This is the Effect→Svelte counterpart to {@link streamFromStore}. Unlike the
 * `useX` hooks, it takes an explicit `runtime` rather than reading the Svelte
 * context, so it can be called outside component initialization (e.g. in module
 * scope or a load function) and is straightforward to test.
 *
 * The Effect fiber driving the store is forked lazily on the first subscription
 * and interrupted when the last subscriber unsubscribes, mirroring Svelte's
 * start/stop notifier semantics. Because `SubscriptionRef.changes` re-emits the
 * current value on subscribe, subscribers receive the up-to-date value
 * immediately; the ref's current value is also used as the store's initial
 * value for reads that occur before the fiber has emitted.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { subscriptionRefToStore } from '@thomasfosterau/effect-svelte';
 *   import { getRuntime } from '@thomasfosterau/effect-svelte';
 *
 *   // Assume counterRef is a SubscriptionRef<number>
 *   const count = subscriptionRefToStore(counterRef, getRuntime());
 * </script>
 *
 * <p>Count: {$count}</p>
 * ```
 */
export function subscriptionRefToStore<A>(
  ref: SubscriptionRef.SubscriptionRef<A>,
  runtime: RuntimeLike<never>,
): Readable<A> {
  // Read the current value synchronously so the store has a sensible initial
  // value before the fiber starts. `SubscriptionRef.changes` re-emits the
  // current value on subscribe, so no update is missed.
  const initial = SubscriptionRef.getUnsafe(ref);
  return streamToStore(SubscriptionRef.changes(ref), initial, runtime);
}

/**
 * Converts an Effect `Stream` into a Svelte
 * [readable store](https://svelte.dev/docs/svelte/stores), tracking the latest
 * emitted value. The given `initial` value is used until the stream emits.
 *
 * Like {@link subscriptionRefToStore}, this takes an explicit `runtime` so it
 * can be used outside component initialization, and forks the stream on the
 * first subscription / interrupts it on the last unsubscribe.
 *
 * @example
 * ```ts
 * import { streamToStore } from '@thomasfosterau/effect-svelte';
 * import { Stream } from 'effect';
 *
 * const ticks = streamToStore(
 *   Stream.tick('1 second').pipe(Stream.scan(0, (n) => n + 1)),
 *   0,
 *   runtime,
 * );
 * ```
 */
export function streamToStore<A, E>(
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
