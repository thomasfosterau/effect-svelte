import { Effect, Fiber, Stream } from "effect";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import { Reactivity } from "effect/reactivity";
import { getRuntime } from "./context.svelte.js";
import { interruptFiber, runFork, runSync, type RuntimeLike } from "./internal/run.js";
import { makeResult } from "./internal/result.svelte.js";
import { streamState } from "./internal/subscribe.js";

/** The handle {@link reactiveQuery} returns. */
export interface ReactiveQueryReturn<A, E> {
  /** The current result, re-derived whenever the keys are invalidated. */
  readonly current: AsyncResult.AsyncResult<A, E>;
}

/** Options shared by {@link reactiveQuery}, {@link reactiveStream} and {@link reactiveMutation}. */
export interface ReactiveOptions<R> {
  /**
   * Run against this runtime instead of the ambient context. Must still provide
   * `Reactivity.Reactivity`; when provided, the effect's `R` is otherwise
   * constrained to what the runtime provides.
   */
  readonly runtime?: RuntimeLike<R | Reactivity.Reactivity>;
}

/**
 * Creates a reactive query that automatically re-runs when the specified keys are invalidated.
 *
 * Note: Make sure your runtime includes `Reactivity.layer` from `effect/reactivity`.
 *
 * @param keys - Reactivity keys that this query depends on
 * @param effectFn - The Effect to run when keys are invalidated
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { reactiveQuery, AsyncResult } from '@thomasfosterau/effect-svelte';
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
 * {#if AsyncResult.isSuccess(user.current)}
 *   <p>User: {user.current.value.name}</p>
 * {/if}
 * ```
 */
export function reactiveQuery<A, E, R>(
  keys: () => ReadonlyArray<unknown>,
  effectFn: () => Effect.Effect<A, E, R>,
  options: ReactiveOptions<R> = {},
): ReactiveQueryReturn<A, E> {
  const runtime = options.runtime ?? (getRuntime() as RuntimeLike<R | Reactivity.Reactivity>);

  const state = makeResult<A, E>();
  let fiber: Fiber.Fiber<void, never> | null = null;

  $effect(() => {
    // Get the current keys (tracks Svelte dependencies)
    const currentKeys = keys();
    const effect = effectFn();

    // Mark as waiting, preserving any previous value.
    state.startWaiting();

    // Run the reactive query inside a scope so that the registered
    // invalidation handlers are cleaned up when the fiber is interrupted.
    const queryEffect = Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* Reactivity.query(effect, currentKeys);
        yield* Stream.runForEach(Stream.fromQueue(queue), (value) =>
          Effect.sync(() => {
            state.succeed(value);
          }),
        );
      }),
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          state.failCause(cause);
        }),
      ),
    );

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

  return {
    get current() {
      return state.current;
    },
  };
}

/** The handle {@link reactiveStream} returns. */
export interface ReactiveStreamReturn<A, E> {
  readonly current: AsyncResult.AsyncResult<ReadonlyArray<A>, E>;
  readonly values: ReadonlyArray<A>;
  readonly latest: A | undefined;
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
  options: ReactiveOptions<R> = {},
): ReactiveStreamReturn<A, E> {
  const runtime = options.runtime ?? (getRuntime() as RuntimeLike<R | Reactivity.Reactivity>);
  return streamState(runtime, () => {
    const currentKeys = typeof keys === "function" ? keys() : keys;
    const currentEffect = typeof effect === "function" ? effect() : effect;
    return Reactivity.stream(currentEffect, currentKeys);
  });
}

/** The handle {@link reactiveMutation} returns. */
export interface ReactiveMutationReturn<A, E> {
  readonly current: AsyncResult.AsyncResult<A, E>;
  run: () => void;
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
  options: ReactiveOptions<R> = {},
): ReactiveMutationReturn<A, E> {
  const runtime = options.runtime ?? (getRuntime() as RuntimeLike<R | Reactivity.Reactivity>);

  const state = makeResult<A, E>();
  let currentFiber: Fiber.Fiber<A, E> | null = null;

  const run = () => {
    if (currentFiber !== null) {
      interruptFiber(currentFiber);
    }

    const currentKeys = typeof keys === "function" ? keys() : keys;
    const currentEffect = typeof effect === "function" ? effect() : effect;

    state.startWaiting();

    const mutationEffect = Reactivity.mutation(currentEffect, currentKeys);
    const runningFiber = runFork(runtime)(mutationEffect);
    currentFiber = runningFiber;

    runFork(runtime)(
      Effect.gen(function* () {
        const exit = yield* Fiber.await(runningFiber);
        if (currentFiber === runningFiber) {
          state.settle(exit);
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
    get current() {
      return state.current;
    },
    run,
  };
}

/**
 * Returns a function that manually invalidates reactivity keys, causing any
 * reactive queries depending on those keys to re-run.
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
export function useInvalidateKeys(
  options: ReactiveOptions<never> = {},
): (keys: ReadonlyArray<unknown>) => void {
  const runtime = options.runtime ?? (getRuntime() as RuntimeLike<Reactivity.Reactivity>);
  return (keys) => {
    runSync(runtime)(Reactivity.invalidate(keys));
  };
}
