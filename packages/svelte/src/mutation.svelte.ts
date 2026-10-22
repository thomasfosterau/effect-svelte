import type * as Effect from "effect/Effect";
import { untrack } from "svelte";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import { getRuntime } from "./context.svelte.js";
import { makeMutation, type MutationCallbacks } from "./internal/mutation.js";
import type { RuntimeLike } from "./internal/run.js";
import { makeResult } from "./internal/result.svelte.js";

export type { MutationCallbacks } from "./internal/mutation.js";

/**
 * Options for {@link useMutation}: the lifecycle {@link MutationCallbacks} plus
 * an optional explicit `runtime`.
 */
export type UseMutationOptions<A, E, I, R, C> = MutationCallbacks<A, E, I, C> & {
  /**
   * Run against this runtime instead of the ambient context. When provided, the
   * mutation's `R` is constrained to what the runtime provides.
   */
  readonly runtime?: RuntimeLike<R>;
};

/** The handle {@link useMutation} returns. */
export interface UseMutationReturn<A, E, I> {
  /**
   * The current result state of the mutation. Starts `Initial`; each `mutate`
   * marks it waiting (preserving the previous value) and settles to
   * `Success` / `Failure`.
   */
  readonly current: AsyncResult.AsyncResult<A, E>;

  /**
   * Run the mutation with `input`. A new call interrupts any in-flight run.
   * It runs untracked, so calling it from an `$effect` does not make that
   * effect depend on state `fn`, the Effect, the callbacks or the re-run
   * queries read.
   */
  readonly mutate: (input: I) => void;

  /** Interrupt any in-flight run and reset `current` back to `Initial`. */
  readonly reset: () => void;
}

/**
 * A TanStack-Query-shaped mutation hook: run an effectful `fn(input)` on
 * demand, track its {@link AsyncResult.AsyncResult}, and fire lifecycle
 * callbacks.
 *
 * Optimistic updates follow the TanStack model — apply the change in `onMutate`
 * and return a snapshot as `context`, then roll back in `onError`. `invalidates`
 * re-runs any reactive queries depending on the given keys after success (this
 * requires the runtime to include `Reactivity.layer`).
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useMutation, AsyncResult } from '@thomasfosterau/effect-svelte';
 *   import { Effect } from 'effect';
 *
 *   const addTodo = useMutation(
 *     (title: string) => saveTodo(title),
 *     {
 *       invalidates: ['todos'],
 *       onSuccess: (todo) => console.log('added', todo.id),
 *     },
 *   );
 * </script>
 *
 * <button onclick={() => addTodo.mutate('Buy milk')}>Add</button>
 *
 * {#if AsyncResult.isWaiting(addTodo.current)}
 *   <p>Saving…</p>
 * {/if}
 * ```
 */
export function useMutation<A, E, I, R, C = unknown>(
  fn: (input: I) => Effect.Effect<A, E, R>,
  options: UseMutationOptions<A, E, I, R, C> = {},
): UseMutationReturn<A, E, I> {
  // SAFETY: the shared runtime context is untyped (`RuntimeLike<never>`); without
  // `options.runtime`, the documented contract is that the ancestor `provideRuntime()`
  // supplied every service `R` names.
  const runtime = options.runtime ?? (getRuntime() as RuntimeLike<R>);
  const state = makeResult<A, E>();
  const core = makeMutation(runtime, state, fn, options);

  // Interrupt any in-flight mutation when the component unmounts.
  $effect(() => () => core.interrupt());

  return {
    get current() {
      return state.current;
    },
    // Untracked: `fn`, `onMutate` and the Effect up to its first async step
    // run inside `mutate`, and so do `onSuccess` / `onError` / `onSettled` and
    // the invalidation's re-run queries when the Effect settles synchronously.
    // Tracked, a `mutate` from a caller's `$effect` would subscribe that effect
    // to all of their reads.
    mutate: (input) => untrack(() => core.mutate(input)),
    reset: core.reset,
  };
}
