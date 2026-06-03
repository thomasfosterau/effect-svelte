import { SubscriptionRef, PubSub, Stream, Effect, Fiber } from "effect";
import { getRuntime } from "./context.svelte.js";
import { interruptFiber, runFork, runSync, type RuntimeLike } from "./internal/run.js";

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

  // Get initial value synchronously
  let value = $state<A>(runSync(runtime)(SubscriptionRef.get(ref)));
  let fiber: Fiber.RuntimeFiber<void, never> | null = null;

  $effect(() => {
    // Subscribe to changes - changes is a property on the ref
    const changesStream = ref.changes;

    const subscription = Stream.runForEach(changesStream, (newValue: A) =>
      Effect.sync(() => {
        value = newValue;
      }),
    );

    // Run the subscription
    fiber = runFork(runtime)(subscription);

    // Cleanup: interrupt subscription on unmount
    return () => {
      if (fiber !== null) {
        interruptFiber(fiber);
        fiber = null;
      }
    };
  });

  return {
    get current() {
      return value;
    },
  };
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

  let values = $state<A[]>([]);
  let fiber: Fiber.RuntimeFiber<void, never> | null = null;

  $effect(() => {
    // Reset values
    values = [];

    // Subscribe to the PubSub. The subscription is scoped so it is cleaned up
    // when the fiber is interrupted on unmount.
    const subscriptionEffect = Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* PubSub.subscribe(pubsub);

        // Process messages from the queue
        yield* Stream.runForEach(Stream.fromQueue(queue), (value) =>
          Effect.sync(() => {
            // Use reassignment for Svelte reactivity
            values = [...values, value];
          }),
        );
      }),
    );

    // Run the subscription
    fiber = runFork(runtime)(subscriptionEffect);

    // Cleanup: interrupt subscription on unmount
    return () => {
      if (fiber !== null) {
        interruptFiber(fiber);
        fiber = null;
      }
    };
  });

  return {
    get values() {
      return values;
    },
    get latest() {
      return values.length > 0 ? values[values.length - 1] : undefined;
    },
  };
}
