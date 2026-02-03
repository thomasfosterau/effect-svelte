import { SubscriptionRef, PubSub, Stream, Effect, Runtime, Fiber } from "effect";
import { getRuntime } from "./context.svelte.js";

/**
 * Subscribe to an Effect SubscriptionRef and get reactive updates.
 * Returns the current value which updates automatically when the ref changes.
 * 
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useSubscriptionRef } from 'effect-svelte';
 *   import { SubscriptionRef, Effect } from 'effect';
 *   
 *   // Assume counterRef is a SubscriptionRef<number>
 *   const count = useSubscriptionRef(counterRef);
 * </script>
 * 
 * <p>Count: {count}</p>
 * ```
 */
export function useSubscriptionRef<A>(
  ref: SubscriptionRef.SubscriptionRef<A>
): A {
  const runtime = getRuntime();
  
  // Get initial value synchronously
  let value = $state<A>(Runtime.runSync(runtime)(SubscriptionRef.get(ref)));
  let fiber = $state<Fiber.RuntimeFiber<void, never> | null>(null);

  $effect(() => {
    // Subscribe to changes - changes is a property on the ref
    const changesStream = ref.changes;
    
    const subscription = Stream.runForEach(changesStream, (newValue: A) =>
      Effect.sync(() => {
        value = newValue;
      })
    );

    // Run the subscription
    fiber = Runtime.runFork(runtime)(subscription) as Fiber.RuntimeFiber<void, never>;

    // Cleanup: interrupt subscription on unmount
    return () => {
      if (fiber !== null) {
        Runtime.runSync(runtime)(Fiber.interrupt(fiber));
        fiber = null;
      }
    };
  });

  return value;
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
 *   import { usePubSub } from 'effect-svelte';
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
export function usePubSub<A>(
  pubsub: PubSub.PubSub<A>
): UsePubSubReturn<A> {
  const runtime = getRuntime();
  
  let values = $state<A[]>([]);
  let fiber = $state<Fiber.RuntimeFiber<void, never> | null>(null);

  $effect(() => {
    // Reset values
    values = [];

    // Subscribe to the PubSub
    const subscriptionEffect = Effect.gen(function* () {
      const queue = yield* PubSub.subscribe(pubsub);
      
      // Process messages from the queue
      yield* Stream.runForEach(
        Stream.fromQueue(queue),
        (value) => Effect.sync(() => {
          values.push(value);
        })
      );
    });

    // Run the subscription
    fiber = Runtime.runFork(runtime)(subscriptionEffect);

    // Cleanup: interrupt subscription on unmount
    return () => {
      if (fiber !== null) {
        Runtime.runSync(runtime)(Fiber.interrupt(fiber));
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
    }
  };
}
