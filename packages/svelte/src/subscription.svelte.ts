import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { getRuntime } from "./context.svelte.js";
import { runSync, type RuntimeLike } from "./internal/run.js";
import { streamState, valueState } from "./internal/subscribe.js";

/** Options for {@link useSubscriptionRef}. */
export interface UseSubscriptionRefOptions<R> {
  /** Run against this runtime instead of the ambient context. */
  readonly runtime?: RuntimeLike<R>;
}

/** Options for {@link usePubSub}. */
export interface UsePubSubOptions<R> {
  /** Run against this runtime instead of the ambient context. */
  readonly runtime?: RuntimeLike<R>;
}

/** The handle {@link useSubscriptionRef} returns. */
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
export function useSubscriptionRef<A, R = never>(
  ref: SubscriptionRef.SubscriptionRef<A>,
  options: UseSubscriptionRefOptions<R> = {},
): UseSubscriptionRefReturn<A> {
  // SAFETY: the shared runtime context is untyped (`RuntimeLike<never>`); without
  // `options.runtime`, the documented contract is that the ancestor `provideRuntime()`
  // supplied every service `R` names.
  const runtime = options.runtime ?? (getRuntime() as RuntimeLike<R>);

  // Get the initial value synchronously so it is available before (and during
  // SSR, instead of) the subscription. `SubscriptionRef.changes` re-emits the
  // current value on subscribe, so no update is missed.
  const initial = runSync(runtime)(SubscriptionRef.get(ref));
  return valueState(runtime, initial, () => SubscriptionRef.changes(ref));
}

/** The handle {@link usePubSub} returns. */
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
export function usePubSub<A, R = never>(
  pubsub: PubSub.PubSub<A>,
  options: UsePubSubOptions<R> = {},
): UsePubSubReturn<A> {
  // SAFETY: the shared runtime context is untyped (`RuntimeLike<never>`); without
  // `options.runtime`, the documented contract is that the ancestor `provideRuntime()`
  // supplied every service `R` names.
  const runtime = options.runtime ?? (getRuntime() as RuntimeLike<R>);
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
