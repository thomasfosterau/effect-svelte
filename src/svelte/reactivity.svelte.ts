import { Cause, Effect, Exit, Fiber, Stream } from "effect";
import { Reactivity } from "effect/unstable/reactivity";
import { getRuntime } from "./context.svelte.js";
import { interruptFiber, runFork, runSync, type RuntimeLike } from "./internal/run.js";
import { assignResult } from "./internal/result.js";
import type { AsyncResult } from "./types.js";

/**
 * Creates a reactive query that automatically re-runs when the specified keys are invalidated.
 * Returns the current result as a Svelte reactive value.
 *
 * Note: Make sure your runtime includes `Reactivity.layer` from `effect/unstable/reactivity`.
 *
 * @param keys - Reactivity keys that this query depends on
 * @param effectFn - The Effect to run when keys are invalidated
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
  const runtime = getRuntime() as RuntimeLike<R | Reactivity.Reactivity>;

  // The result is updated by mutating this object in place (never reassigning),
  // so the reference returned to the caller stays reactive.
  const result = $state<Record<string, unknown>>({ _tag: "initial" });
  let fiber: Fiber.Fiber<void, never> | null = null;

  $effect(() => {
    // Get the current keys (tracks Svelte dependencies)
    const currentKeys = keys();
    const effect = effectFn();

    // Set to pending state
    assignResult(result, { _tag: "pending" });

    // Run the reactive query inside a scope so that the registered
    // invalidation handlers are cleaned up when the fiber is interrupted.
    const queryEffect = Effect.scoped(
      Effect.gen(function* () {
        // Create a reactive query with the current keys
        const queue = yield* Reactivity.query(effect, currentKeys);

        // Subscribe to the queue to get updates
        yield* Stream.runForEach(Stream.fromQueue(queue), (value) =>
          Effect.sync(() => {
            assignResult(result, { _tag: "success", value });
          }),
        );
      }),
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          if (!Cause.hasInterrupts(cause)) {
            assignResult(result, { _tag: "failure", cause });
          }
        }),
      ),
    );

    // Run the query
    const runningFiber = runFork(runtime)(queryEffect);
    fiber = runningFiber;

    // Cleanup: interrupt the fiber when dependencies change or component unmounts
    return () => {
      if (fiber !== null) {
        interruptFiber(fiber);
        fiber = null;
      }
    };
  });

  return result as AsyncResult<A, E>;
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
  const runtime = getRuntime() as RuntimeLike<R | Reactivity.Reactivity>;

  let result = $state<AsyncResult<ReadonlyArray<A>, E>>({ _tag: "initial" });
  let values = $state<A[]>([]);
  let fiber: Fiber.Fiber<void, E> | null = null;

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
    const runningFiber = runFork(runtime)(subscription);
    fiber = runningFiber;

    // Wait for completion and handle result
    runFork(runtime)(
      Effect.gen(function* () {
        const exit = yield* Fiber.await(runningFiber);

        if (fiber === runningFiber) {
          if (Exit.isSuccess(exit)) {
            result = { _tag: "success", value: values };
          } else if (Exit.isFailure(exit)) {
            if (!Cause.hasInterrupts(exit.cause)) {
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
        interruptFiber(fiber);
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
  const runtime = getRuntime() as RuntimeLike<R | Reactivity.Reactivity>;

  let result = $state<AsyncResult<A, E>>({ _tag: "initial" });
  let currentFiber: Fiber.Fiber<A, E> | null = null;

  const run = () => {
    // Interrupt any existing fiber
    if (currentFiber !== null) {
      interruptFiber(currentFiber);
    }

    // Get keys and effect
    const currentKeys = typeof keys === "function" ? keys() : keys;
    const currentEffect = typeof effect === "function" ? effect() : effect;

    // Set to pending state
    result = { _tag: "pending" };

    // Wrap the effect with mutation to invalidate keys
    const mutationEffect = Reactivity.mutation(currentEffect, currentKeys);

    // Run the mutation
    const runningFiber = runFork(runtime)(mutationEffect);
    currentFiber = runningFiber;

    // Handle the result
    runFork(runtime)(
      Effect.gen(function* () {
        const exit = yield* Fiber.await(runningFiber);

        if (currentFiber === runningFiber && Exit.isSuccess(exit)) {
          result = { _tag: "success", value: exit.value };
        } else if (currentFiber === runningFiber && Exit.isFailure(exit)) {
          if (!Cause.hasInterrupts(exit.cause)) {
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
        interruptFiber(currentFiber);
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
 * Returns a function that manually invalidates reactivity keys, causing any
 * reactive queries depending on those keys to re-run.
 *
 * The hook must be called during component initialization (it reads the
 * runtime from Svelte context); the returned function can then be called
 * from anywhere, including event handlers.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useInvalidateKeys } from '@thomasfosterau/effect-svelte';
 *
 *   const invalidate = useInvalidateKeys();
 * </script>
 *
 * <button onclick={() => invalidate(['users'])}>Refresh Users</button>
 * ```
 */
export function useInvalidateKeys(): (keys: ReadonlyArray<unknown>) => void {
  const runtime = getRuntime() as RuntimeLike<Reactivity.Reactivity>;
  return (keys) => {
    runSync(runtime)(Reactivity.invalidate(keys));
  };
}
