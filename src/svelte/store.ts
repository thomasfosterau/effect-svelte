import { Effect, Queue, Stream } from "effect";
import type { Readable } from "svelte/store";

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
