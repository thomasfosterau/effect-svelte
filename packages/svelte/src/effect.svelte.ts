import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { untrack } from "svelte";
import { getRuntime } from "./context.svelte.js";
import {
  emptyFiberSlot,
  interruptFiber,
  interruptSlot,
  runFork,
  trackFiber,
  type RuntimeLike,
} from "./internal/run.js";
import * as ResultState from "./internal/result.svelte.js";

/**
 * Whether a `setData` argument is an updater function rather than a value. As
 * with React's `setState`, a function is always treated as an updater, so a
 * function-typed `A` must be passed wrapped (`() => fn`).
 */
const isUpdater = <A>(
  updater: A | ((previous: Option.Option<A>) => A),
): updater is (previous: Option.Option<A>) => A => P.isFunction(updater);

/** Options for {@link useEffect}. */
export interface UseEffectOptions<R = never> {
  /**
   * If true, the effect will run immediately on mount.
   * If false, the effect will only run when manually triggered via run().
   * Like a manual `run()`, the mount run is untracked: reactive state the
   * effect reads does not re-run it.
   * @default false
   */
  immediate?: boolean;

  /**
   * Run against this runtime instead of the ambient context. When provided, the
   * effect's `R` is constrained to what the runtime provides.
   */
  runtime?: RuntimeLike<R>;
}

/** The handle {@link useEffect} returns. */
export interface UseEffectReturn<A, E> {
  /**
   * The current result state of the effect. Re-running preserves the previous
   * value as a waiting `Success` (stale-while-revalidate).
   */
  readonly current: AsyncResult.AsyncResult<A, E>;

  /**
   * Manually trigger execution of the effect
   */
  run: () => void;

  /**
   * Interrupt the currently running effect
   */
  interrupt: () => void;

  /**
   * Optimistically overwrite the current value with a non-waiting `Success`,
   * without running the effect. Accepts a value or an updater function that
   * receives the current value as an `Option`: `Some` with the value the
   * result holds (a `Success`, or a `Failure` that kept its previous success),
   * `None` if there is none yet. Useful for local cache writes after a
   * mutation, reconciled by the next `run`. An updater that throws propagates
   * to the caller and leaves the result unchanged.
   */
  setData: (updater: A | ((previous: Option.Option<A>) => A)) => void;

  /**
   * `true` while a previous value is being shown but a re-run is in flight
   * (stale-while-revalidate) — i.e. the result is `waiting` and still holds a
   * value.
   */
  readonly isStale: boolean;
}

/**
 * Run a single Effect and track its result state.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useEffect, AsyncResult } from '@thomasfosterau/effect-svelte';
 *   import { Effect } from 'effect';
 *
 *   const fetchData = useEffect(
 *     Effect.delay(Effect.succeed(42), '1 second'),
 *     { immediate: true }
 *   );
 * </script>
 *
 * {#if AsyncResult.isSuccess(fetchData.current)}
 *   <p>Result: {fetchData.current.value}</p>
 * {/if}
 * ```
 */
export function useEffect<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options: UseEffectOptions<R> = {},
): UseEffectReturn<A, E> {
  const { immediate = false } = options;
  // SAFETY: the shared runtime context is untyped (`RuntimeLike<never>`); without
  // `options.runtime`, the documented contract is that the ancestor `provideRuntime()`
  // supplied every service `R` names.
  const runtime = options.runtime ?? (getRuntime() as RuntimeLike<R>);

  const state = ResultState.makeResult<A, E>();
  const slot = emptyFiberSlot<A, E>();

  const run = () => {
    // Interrupt any existing fiber
    interruptSlot(slot);

    // Mark as waiting, preserving the previous value if there is one.
    state.startWaiting();

    // Run the effect and capture the fiber reference
    const runningFiber = runFork(runtime)(effect);
    // Settle the result when the fiber completes, unless a newer run replaced it.
    trackFiber(runtime)(slot, runningFiber, (exit) => state.settle(exit));
  };

  const interrupt = () => {
    if (Option.isSome(slot.current)) {
      interruptFiber(slot.current.value);
      slot.current = Option.none();
      // Return to the initial state so the effect can be run again cleanly.
      state.reset();
    }
  };

  // Set up effect lifecycle
  $effect(() => {
    if (immediate) {
      // Untracked, like a `run()` from an event handler: nothing read while
      // starting the run (the result state, or state the Effect reads
      // synchronously) becomes a dependency that would restart it.
      untrack(run);
    }

    // Cleanup: interrupt any running fiber on unmount
    return () => {
      interrupt();
    };
  });

  const setData = (updater: A | ((previous: Option.Option<A>) => A)): void => {
    // Untracked, so calling `setData` from an `$effect` does not make that
    // effect depend on the result it is about to write.
    const previous = AsyncResult.value(untrack(() => state.current));
    const next = isUpdater(updater) ? updater(previous) : updater;
    state.succeed(next);
  };

  return {
    get current() {
      return state.current;
    },
    run,
    interrupt,
    setData,
    get isStale() {
      return (
        AsyncResult.isWaiting(state.current) && Option.isSome(AsyncResult.value(state.current))
      );
    },
  };
}
