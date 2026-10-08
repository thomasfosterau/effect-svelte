import { Effect, Fiber, Stream } from "effect";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import { Reactivity } from "effect/reactivity";
import { untrack } from "svelte";
import { getRuntime } from "./context.svelte.js";
import { interruptFiber, runFork, runSync, type RuntimeLike } from "./internal/run.js";
import { makeResult } from "./internal/result.svelte.js";
import { streamState } from "./internal/subscribe.js";

/** The handle {@link useReactiveQuery} returns. */
export interface ReactiveQueryReturn<A, E> {
  /** The current result, re-derived whenever the keys are invalidated. */
  readonly current: AsyncResult.AsyncResult<A, E>;
}

/** Options shared by {@link useReactiveQuery}, {@link useReactiveStream} and {@link useReactiveMutation}. */
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
 * `keys` and `effectFn` are called inside `$effect`, so the reactive state they
 * read is tracked: when it changes, the running query is interrupted and a new
 * one starts. Only those two thunks' reads are dependencies: the Effect runs
 * untracked, so state it reads while running (even synchronously, e.g. inside
 * `Effect.sync` or `Effect.gen`) does not restart it. Read anything that should
 * restart the query in a thunk, as `userId` is below.
 *
 * Nothing is thrown: the Effect's failures and defects settle `current` to a
 * `Failure`, and interruption (a dependency change or unmount) leaves it as is.
 *
 * Note: Make sure your runtime includes `Reactivity.layer` from `effect/reactivity`.
 *
 * @param keys - Reactivity keys that this query depends on
 * @param effectFn - Builds the Effect to run initially and whenever the keys are invalidated
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useReactiveQuery, AsyncResult } from '@thomasfosterau/effect-svelte';
 *   import { Effect } from 'effect';
 *
 *   // Query that depends on a user ID key
 *   let userId = $state(1);
 *
 *   const user = useReactiveQuery(
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
export function useReactiveQuery<A, E, R>(
  keys: () => ReadonlyArray<unknown>,
  effectFn: () => Effect.Effect<A, E, R>,
  options: ReactiveOptions<R> = {},
): ReactiveQueryReturn<A, E> {
  const runtime = options.runtime ?? (getRuntime() as RuntimeLike<R | Reactivity.Reactivity>);

  const state = makeResult<A, E>();
  let fiber: Fiber.Fiber<void, never> | null = null;

  $effect(() => {
    // Get the current keys and effect: the reads these thunks make are the
    // only tracked dependencies.
    const currentKeys = keys();
    const effect = effectFn();

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

    // Start the query untracked. `runFork` (and `Reactivity.query`'s own fork)
    // run the Effect synchronously until its first async boundary, so a
    // tracked fork would subscribe this `$effect` to whatever state the Effect
    // happens to read on the way.
    fiber = untrack(() => {
      // Mark as waiting, preserving any previous value.
      state.startWaiting();
      return runFork(runtime)(queryEffect);
    });

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

/** The handle {@link useReactiveStream} returns. */
export interface ReactiveStreamReturn<A, E> {
  /**
   * Every value emitted since the stream last (re)started, as an
   * `AsyncResult`: `Initial` until the first value, then a waiting `Success`; a `Failure` once the
   * Effect fails.
   */
  readonly current: AsyncResult.AsyncResult<ReadonlyArray<A>, E>;
  /** Every value emitted since the stream last (re)started, oldest first. */
  readonly values: ReadonlyArray<A>;
  /** The most recent value emitted since the stream last (re)started, if any. */
  readonly latest: A | undefined;
}

/**
 * Creates a reactive stream that runs `effect` once, then again each time
 * `keys` are invalidated, collecting every result in `values`.
 *
 * When `keys` or `effect` is a thunk, the reactive state it reads is tracked:
 * when that state changes, the running stream is interrupted (a microtask
 * later) and a new one starts with the new keys and Effect, its `values` empty
 * again. Only the
 * thunks' reads are dependencies: the Effect runs untracked, so state it reads
 * while running does not restart the stream (an invalidation re-runs it, and
 * the re-run sees the new state). Read anything that should restart the
 * stream in a thunk, as `channelId` is below. The thunks are called from a
 * `$derived`, so keep them pure (no `$state` writes) and expect them to run
 * during server rendering too.
 *
 * The stream starts when `current`, `values` or `latest` is first read inside
 * an effect or template, and one run is shared by every reader. It is
 * interrupted once the last reader is gone (for example on unmount), and
 * starts afresh if read again later.
 *
 * Nothing is thrown: a failure or defect of the Effect ends the stream and
 * settles `current` to a `Failure` (keeping `values`), after which
 * invalidations no longer re-run it until a thunk's state changes or it
 * restarts. Interruption (a restart, or the last reader leaving) is not a
 * failure.
 *
 * Note: Make sure your runtime includes `Reactivity.layer` from `effect/reactivity`.
 *
 * @param keys - Reactivity keys that this stream depends on, or a thunk returning them
 * @param effect - The Effect to run initially and whenever the keys are invalidated, or a thunk returning it
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useReactiveStream } from '@thomasfosterau/effect-svelte';
 *
 *   let channelId = $state('general');
 *
 *   // Re-fetches whenever the 'messages' key is invalidated, and starts over
 *   // when `channelId` changes.
 *   const messages = useReactiveStream(['messages'], () => fetchMessages(channelId));
 * </script>
 *
 * <ul>
 *   {#each messages.values as batch}
 *     <li>{batch.length} messages</li>
 *   {/each}
 * </ul>
 * ```
 */
export function useReactiveStream<A, E, R>(
  keys: ReadonlyArray<unknown> | (() => ReadonlyArray<unknown>),
  effect: Effect.Effect<A, E, R> | (() => Effect.Effect<A, E, R>),
  options: ReactiveOptions<R> = {},
): ReactiveStreamReturn<A, E> {
  const runtime = options.runtime ?? (getRuntime() as RuntimeLike<R | Reactivity.Reactivity>);

  // `streamState`'s subscriber starts the stream untracked (Svelte runs a
  // `createSubscriber` start callback under `untrack`), so the thunks are read
  // here instead: their reads are this `$derived`'s only dependencies. Each
  // change builds a fresh subscriber, which the readers re-subscribe to, and
  // the old one's fiber is interrupted once its last reader has moved on.
  const source = $derived.by(() => {
    const currentKeys = typeof keys === "function" ? keys() : keys;
    const currentEffect = typeof effect === "function" ? effect() : effect;
    return streamState(runtime, () => Reactivity.stream(currentEffect, currentKeys));
  });

  return {
    get current() {
      return source.current;
    },
    get values() {
      return source.values;
    },
    get latest() {
      return source.latest;
    },
  };
}

/** The handle {@link useReactiveMutation} returns. */
export interface ReactiveMutationReturn<A, E> {
  readonly current: AsyncResult.AsyncResult<A, E>;
  run: () => void;
}

/**
 * Runs a mutation effect and invalidates the specified keys.
 * This will cause any reactive queries depending on these keys to re-run.
 *
 * `run()` starts the mutation (interrupting one still in flight); the keys and
 * Effect thunks are read then. Nothing is thrown: the Effect's failures and
 * defects settle `current` to a `Failure`, and interruption (a newer `run()` or
 * unmount) leaves it as is.
 *
 * Note: Make sure your runtime includes `Reactivity.layer` from `effect/reactivity`.
 *
 * @param keys - Reactivity keys to invalidate after the mutation
 * @param effect - The mutation effect to run
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useReactiveMutation } from '@thomasfosterau/effect-svelte';
 *   import { Effect } from 'effect';
 *
 *   const updateUser = useReactiveMutation(
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
export function useReactiveMutation<A, E, R>(
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
 * Deprecated alias of {@link useReactiveQuery}: creates a reactive query that
 * re-runs when the specified Reactivity keys are invalidated. Nothing is
 * thrown: failures and defects settle `current` to a `Failure`.
 *
 * @deprecated Use {@link useReactiveQuery} instead; removed in the next minor release.
 */
export const reactiveQuery: typeof useReactiveQuery = useReactiveQuery;

/**
 * Deprecated alias of {@link useReactiveStream}: runs an Effect once, then
 * again each time the specified Reactivity keys are invalidated, collecting
 * every result. Nothing is thrown: a failure or defect settles `current` to a
 * `Failure`.
 *
 * @deprecated Use {@link useReactiveStream} instead; removed in the next minor release.
 */
export const reactiveStream: typeof useReactiveStream = useReactiveStream;

/**
 * Deprecated alias of {@link useReactiveMutation}: runs a mutation Effect and
 * invalidates the specified Reactivity keys. Nothing is thrown: failures and
 * defects settle `current` to a `Failure`.
 *
 * @deprecated Use {@link useReactiveMutation} instead; removed in the next minor release.
 */
export const reactiveMutation: typeof useReactiveMutation = useReactiveMutation;

/**
 * Returns a function that manually invalidates reactivity keys, causing any
 * reactive queries depending on those keys to re-run.
 *
 * The invalidation re-runs the matching queries and streams synchronously, up
 * to their first async step. It runs untracked, so calling the function from a
 * consumer's `$effect` does not make that effect depend on state those
 * Effects read.
 *
 * Invalidation itself cannot fail: a re-run query or stream that fails settles
 * its own result to a `Failure`, not this call.
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
    // `Reactivity.invalidate` forks every matching query on the spot, so a
    // tracked call would subscribe the caller's `$effect` to whatever state
    // those queries read before their first async boundary.
    untrack(() => runSync(runtime)(Reactivity.invalidate(keys)));
  };
}
