import { PubSub, Stream, SubscriptionRef } from "effect";
import { getRuntime } from "./context.svelte.js";
import { runSync, type RuntimeLike } from "./internal/run.js";
import { streamState, valueState } from "./internal/subscribe.js";

export interface UseSubscriptionRefReturn<A> {
  /**
   * The current value of the SubscriptionRef
   */
  readonly current: A;
}

/**
 * Subscribe to an Effect SubscriptionRef and get reactive updates.
 * Returns an object exposing the current value via the `current` property.
 *
 * The initial value is read synchronously; the subscription that keeps it up to
 * date starts when `current` is first read inside an effect or template, and is
 * interrupted when the last reader is destroyed.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useSubscriptionRef } from '@thomasfosterau/effect-svelte';
 *   import { SubscriptionRef, Effect } from 'effect';
 *
 *   // Assume counterRef is a SubscriptionRef<number>
 *   const count = useSubscriptionRef(counterRef);
 * </script>
 *
 * <p>Count: {count.current}</p>
 * ```
 */
export function useSubscriptionRef<A>(
  ref: SubscriptionRef.SubscriptionRef<A>,
): UseSubscriptionRefReturn<A> {
  const runtime = getRuntime() as RuntimeLike<never>;

  // Get the initial value synchronously so it is available before (and during
  // SSR, instead of) the subscription. `SubscriptionRef.changes` re-emits the
  // current value on subscribe, so no update is missed.
  const initial = runSync(runtime)(SubscriptionRef.get(ref));
  return valueState(runtime, initial, () => SubscriptionRef.changes(ref));
}

export interface UsePubSubReturn<A> {
  /**
   * All values received from the PubSub
   */
  readonly values: ReadonlyArray<A>;

  /**
   * The most recent value (undefined if none)
   */
  readonly latest: A | undefined;
}

/**
 * Subscribe to an Effect PubSub and collect messages.
 *
 * The subscription starts when `values`/`latest` is first read inside an effect
 * or template, and is interrupted when the last reader is destroyed.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { usePubSub } from '@thomasfosterau/effect-svelte';
 *   import { PubSub } from 'effect';
 *
 *   // Assume messagePubSub is a PubSub<string>
 *   const messages = usePubSub(messagePubSub);
 * </script>
 *
 * <p>Latest: {messages.latest}</p>
 * <ul>
 *   {#each messages.values as msg}
 *     <li>{msg}</li>
 *   {/each}
 * </ul>
 * ```
 */
export function usePubSub<A>(pubsub: PubSub.PubSub<A>): UsePubSubReturn<A> {
  const runtime = getRuntime() as RuntimeLike<never>;
  const state = streamState(runtime, () => Stream.fromPubSub(pubsub));
  return {
    get values() {
      return state.values;
    },
    get latest() {
      return state.latest;
    },
  };
}
