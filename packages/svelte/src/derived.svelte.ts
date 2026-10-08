import { Duration, Effect, Fiber } from "effect";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import { untrack } from "svelte";
import { getRuntime } from "./context.svelte.js";
import { interruptFiber, runFork, type RuntimeLike } from "./internal/run.js";
import { makeResult } from "./internal/result.svelte.js";

/** Options for {@link useDerived}. */
export interface UseDerivedOptions<R = never> {
  /**
   * Debounce re-runs by this duration: when a dependency changes, wait this
   * long before running, and if another change arrives within the window,
   * restart the wait. The previous value stays visible during the window (the
   * result only flips to `waiting` once the run actually starts).
   *
   * Accepts any Effect `Duration.Input` (e.g. `"300 millis"`, `500`,
   * `Duration.seconds(1)`).
   */
  readonly debounce?: Duration.Input;

  /**
   * Run against this runtime instead of the ambient context. When provided, the
   * effect's `R` is constrained to what the runtime provides.
   */
  readonly runtime?: RuntimeLike<R>;
}

/** The handle {@link useDerived} returns. */
export interface DerivedReturn<A, E> {
  /**
   * The current result. While re-running after a dependency change, the
   * previous value is kept as a waiting `Success` (stale-while-revalidate).
   */
  readonly current: AsyncResult.AsyncResult<A, E>;
}

/**
 * Re-run an effect whenever reactive dependencies change.
 *
 * `fn` is called inside `$effect`, so the reactive state it reads while
 * building the Effect is tracked; when that state changes, the previous fiber
 * is interrupted and a new one starts. Only `fn`'s own reads are dependencies:
 * the Effect runs untracked, so state it reads while running (even
 * synchronously, e.g. inside `Effect.sync` or `Effect.gen`) does not restart
 * it. Read anything that should restart the run in `fn` itself, as in
 * `() => search(query)`.
 *
 * Nothing is thrown: the Effect's failures and defects settle `current` to a
 * `Failure`, and interruption (a dependency change or unmount) leaves it as is.
 *
 * Pass `{ debounce }` to coalesce rapid dependency changes (e.g. a search box):
 * interrupting the previous fiber cancels its pending debounce sleep, so only
 * the last change in a burst actually runs.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useDerived, AsyncResult } from '@thomasfosterau/effect-svelte';
 *   import { Effect } from 'effect';
 *
 *   let query = $state('');
 *
 *   const results = useDerived(
 *     () => search(query),
 *     { debounce: '300 millis' },
 *   );
 * </script>
 *
 * <input bind:value={query} />
 *
 * {#if AsyncResult.isSuccess(results.current)}
 *   <ul>{#each results.current.value as r}<li>{r}</li>{/each}</ul>
 * {/if}
 * ```
 */
export function useDerived<A, E, R>(
  fn: () => Effect.Effect<A, E, R>,
  options: UseDerivedOptions<R> = {},
): DerivedReturn<A, E> {
  const { debounce } = options;
  const runtime = options.runtime ?? (getRuntime() as RuntimeLike<R>);

  const state = makeResult<A, E>();
  let currentFiber: Fiber.Fiber<A, E> | null = null;

  $effect(() => {
    // Interrupt previous fiber if it exists (this also cancels a pending
    // debounce sleep, which is what makes debouncing work).
    if (currentFiber !== null) {
      interruptFiber(currentFiber);
    }

    // Get the effect: the reads `fn` makes are the only tracked dependencies.
    const effect = fn();

    // Start the run untracked. `runFork` runs an Effect synchronously until its
    // first async boundary, so a tracked fork would subscribe this `$effect` to
    // whatever state the Effect happens to read on the way.
    untrack(() => {
      let runningFiber: Fiber.Fiber<A, E>;
      if (debounce === undefined) {
        // Mark as waiting, preserving the previous value if there is one.
        state.startWaiting();
        runningFiber = runFork(runtime)(effect);
      } else {
        // Wait out the debounce window first; only then flip to waiting and
        // run, so the previous value stays visible until the run begins.
        runningFiber = runFork(runtime)(
          Effect.gen(function* () {
            yield* Effect.sleep(debounce);
            yield* Effect.sync(() => state.startWaiting());
            return yield* effect;
          }),
        );
      }
      currentFiber = runningFiber;

      // Settle the result when the fiber completes, unless deps changed first.
      runFork(runtime)(
        Effect.gen(function* () {
          const exit = yield* Fiber.await(runningFiber);
          if (currentFiber === runningFiber) {
            state.settle(exit);
            currentFiber = null;
          }
        }),
      );
    });

    // Cleanup: interrupt the fiber when dependencies change or component unmounts
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
  };
}
