import { Reactivity } from "@effect/experimental";
import { Effect, Runtime, Fiber, Exit, Scope, Mailbox, Stream } from "effect";
import { getRuntime } from "./context.svelte.js";
import type { AsyncResult } from "./types.js";

/**
 * Creates a reactive query that automatically re-runs when the specified keys are invalidated.
 * Returns the current result as a Svelte reactive value.
 *
 * Note: Make sure your runtime includes the Reactivity layer from @effect/experimental.
 *
 * @param keys - Reactivity keys that this query depends on
 * @param effect - The Effect to run when keys are invalidated
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { reactiveQuery } from '@thomasfosterau/effect-svelte';
 *   import { Effect } from 'effect';
 *
 *   // Query that depends on a user ID key
 *   let userId = $state(1);
 *
 *   const user = reactiveQuery(
 *     () => ['user', userId],
 *     () => Effect.gen(function* () {
 *       const data = yield* fetchUser(userId);
 *       return data;
 *     })
 *   );
 * </script>
 *
 * {#if user._tag === 'success'}
 *   <p>User: {user.value.name}</p>
 * {/if}
 * ```
 */
export function reactiveQuery<A, E, R>(
  keys: () => ReadonlyArray<unknown>,
  effectFn: () => Effect.Effect<A, E, R>,
): AsyncResult<A, E> {
  const runtime = getRuntime();

  let result = $state<AsyncResult<A, E>>({ _tag: "initial" });
  let fiber = $state<Fiber.RuntimeFiber<void, never> | null>(null);

  $effect(() => {
    // Get the current keys (tracks Svelte dependencies)
    const currentKeys = keys();
    const effect = effectFn();

    // Set to pending state
    result = { _tag: "pending" };

    // Create a scope for this query
    const queryEffect = Effect.gen(function* () {
      const scope = yield* Scope.make();

      // Create a reactive query with the current keys
      const mb = yield* Reactivity.query(effect, currentKeys).pipe(
        Effect.provideService(Scope.Scope, scope),
      );

      // Subscribe to the mailbox to get updates
      yield* Stream.runForEach(Mailbox.toStream(mb), (value) =>
        Effect.sync(() => {
          result = { _tag: "success", value };
        }),
      );
    }).pipe(
      Effect.catchAllCause((cause) =>
        Effect.sync(() => {
          if (!Exit.isInterrupted(Exit.failCause(cause))) {
            result = { _tag: "failure", cause };
          }
        }),
      ),
    );

    // Run the query
    const runningFiber = Runtime.runFork(runtime as Runtime.Runtime<any>)(queryEffect);
    fiber = runningFiber;

    // Cleanup: interrupt the fiber when dependencies change or component unmounts
    return () => {
      if (fiber !== null) {
        Runtime.runSync(runtime)(Fiber.interrupt(fiber));
        fiber = null;
      }
    };
  });

  return result;
}

/**
 * Creates a reactive stream that emits values whenever the specified keys are invalidated.
 * The effect re-runs automatically when keys change.
 *
 * @param keys - Reactivity keys that this stream depends on
 * @param effect - The Effect to run when keys are invalidated
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { reactiveStream } from '@thomasfosterau/effect-svelte';
 *   import { Effect } from 'effect';
 *
 *   const messages = reactiveStream(
 *     ['messages'],
 *     Effect.gen(function* () {
 *       const data = yield* fetchMessages();
 *       return data;
 *     })
 *   );
 * </script>
 *
 * <ul>
 *   {#each messages.values as msg}
 *     <li>{msg}</li>
 *   {/each}
 * </ul>
 * ```
 */
export function reactiveStream<A, E, R>(
  keys: ReadonlyArray<unknown> | (() => ReadonlyArray<unknown>),
  effect: Effect.Effect<A, E, R> | (() => Effect.Effect<A, E, R>),
): {
  readonly result: AsyncResult<ReadonlyArray<A>, E>;
  readonly values: ReadonlyArray<A>;
  readonly latest: A | undefined;
} {
  const runtime = getRuntime();

  let result = $state<AsyncResult<ReadonlyArray<A>, E>>({ _tag: "initial" });
  let values = $state<A[]>([]);
  let fiber = $state<Fiber.RuntimeFiber<void, E> | null>(null);

  $effect(() => {
    // Reset state
    result = { _tag: "pending" };
    values = [];

    // Get keys and effect (supports both static and dynamic)
    const currentKeys = typeof keys === "function" ? keys() : keys;
    const currentEffect = typeof effect === "function" ? effect() : effect;

    // Create a reactive stream
    const reactiveStreamEffect = Reactivity.stream(currentEffect, currentKeys);

    // Subscribe to the stream
    const subscription = Stream.runForEach(reactiveStreamEffect, (value) =>
      Effect.sync(() => {
        values = [...values, value];
        result = { _tag: "success", value: values };
      }),
    );

    // Run the subscription
    const runningFiber = Runtime.runFork(runtime as Runtime.Runtime<any>)(subscription);
    fiber = runningFiber;

    // Wait for completion and handle result
    Runtime.runFork(runtime)(
      Effect.gen(function* () {
        const exit = yield* Fiber.await(runningFiber);

        if (fiber === runningFiber) {
          if (Exit.isSuccess(exit)) {
            result = { _tag: "success", value: values };
          } else if (Exit.isFailure(exit)) {
            if (!Exit.isInterrupted(exit)) {
              result = { _tag: "failure", cause: exit.cause };
            } else {
              if (values.length > 0) {
                result = { _tag: "success", value: values };
              }
            }
          }
          fiber = null;
        }
      }),
    );

    // Cleanup: interrupt the subscription on unmount
    return () => {
      if (fiber !== null) {
        Runtime.runSync(runtime)(Fiber.interrupt(fiber));
        fiber = null;
      }
    };
  });

  return {
    get result() {
      return result;
    },
    get values() {
      return values;
    },
    get latest() {
      return values.length > 0 ? values[values.length - 1] : undefined;
    },
  };
}

/**
 * Runs a mutation effect and invalidates the specified keys.
 * This will cause any reactive queries depending on these keys to re-run.
 *
 * @param keys - Reactivity keys to invalidate after the mutation
 * @param effect - The mutation effect to run
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { reactiveMutation } from '@thomasfosterau/effect-svelte';
 *   import { Effect } from 'effect';
 *
 *   const updateUser = reactiveMutation(
 *     ['user', userId],
 *     Effect.gen(function* () {
 *       yield* updateUserInDB(userId, data);
 *     })
 *   );
 * </script>
 *
 * <button onclick={() => updateUser.run()}>Update</button>
 * ```
 */
export function reactiveMutation<A, E, R>(
  keys: ReadonlyArray<unknown> | (() => ReadonlyArray<unknown>),
  effect: Effect.Effect<A, E, R> | (() => Effect.Effect<A, E, R>),
): {
  readonly result: AsyncResult<A, E>;
  run: () => void;
} {
  const runtime = getRuntime();

  let result = $state<AsyncResult<A, E>>({ _tag: "initial" });
  let currentFiber = $state<Fiber.RuntimeFiber<A, E> | null>(null);

  const run = () => {
    // Interrupt any existing fiber
    if (currentFiber !== null) {
      Runtime.runSync(runtime)(Fiber.interrupt(currentFiber));
    }

    // Get keys and effect
    const currentKeys = typeof keys === "function" ? keys() : keys;
    const currentEffect = typeof effect === "function" ? effect() : effect;

    // Set to pending state
    result = { _tag: "pending" };

    // Wrap the effect with mutation to invalidate keys
    const mutationEffect = Reactivity.mutation(currentEffect, currentKeys);

    // Run the mutation
    const runningFiber = Runtime.runFork(runtime as Runtime.Runtime<any>)(mutationEffect);
    currentFiber = runningFiber;

    // Handle the result
    Runtime.runFork(runtime)(
      Effect.gen(function* () {
        const exit = yield* Fiber.await(runningFiber);

        if (currentFiber === runningFiber && Exit.isSuccess(exit)) {
          result = { _tag: "success", value: exit.value };
        } else if (currentFiber === runningFiber && Exit.isFailure(exit)) {
          if (!Exit.isInterrupted(exit)) {
            result = { _tag: "failure", cause: exit.cause };
          }
        }

        if (currentFiber === runningFiber) {
          currentFiber = null;
        }
      }),
    );
  };

  $effect(() => {
    // Cleanup: interrupt any running fiber on unmount
    return () => {
      if (currentFiber !== null) {
        Runtime.runSync(runtime)(Fiber.interrupt(currentFiber));
        currentFiber = null;
      }
    };
  });

  return {
    get result() {
      return result;
    },
    run,
  };
}

/**
 * Manually invalidates the specified reactivity keys.
 * This will cause any reactive queries depending on these keys to re-run.
 *
 * @param keys - Reactivity keys to invalidate
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { Svelte } from 'effect-svelte';
 *
 *   function handleRefresh() {
 *     Svelte.invalidateKeys(['users']);
 *   }
 * </script>
 *
 * <button onclick={handleRefresh}>Refresh Users</button>
 * ```
 */
export function invalidateKeys(keys: ReadonlyArray<unknown>): void {
  const runtime = getRuntime();
  Runtime.runSync(runtime as Runtime.Runtime<any>)(Reactivity.invalidate(keys));
}
