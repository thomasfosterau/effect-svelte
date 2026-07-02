import type { Effect } from "effect";
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { getRuntime } from "./context.svelte.js";
import { makeMutation, type MutationCallbacks } from "./internal/mutation.js";
import type { RuntimeLike } from "./internal/run.js";
import { makeResult } from "./internal/result.svelte.js";

export type { MutationCallbacks } from "./internal/mutation.js";

export interface UseMutationReturn<A, E, I> {
  /**
   * The current result state of the mutation. Starts `Initial`; each `mutate`
   * marks it waiting (preserving the previous value) and settles to
   * `Success` / `Failure`.
   */
  readonly current: AsyncResult.AsyncResult<A, E>;

  /** Run the mutation with `input`. A new call interrupts any in-flight run. */
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
  options: MutationCallbacks<A, E, I, C> = {},
): UseMutationReturn<A, E, I> {
  const runtime = getRuntime() as RuntimeLike<R>;
  const state = makeResult<A, E>();
  const core = makeMutation(runtime, state, fn, options);

  // Interrupt any in-flight mutation when the component unmounts.
  $effect(() => () => core.interrupt());

  return {
    get current() {
      return state.current;
    },
    mutate: core.mutate,
    reset: core.reset,
  };
}
