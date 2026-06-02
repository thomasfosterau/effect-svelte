import { Effect } from "effect";
import { useEffect } from "./effect.svelte.js";
import type { AsyncResult } from "./types.js";

export interface UseQueryReturn<A, E> {
  /**
   * The current result state of the query
   */
  readonly result: AsyncResult<A, E>;

  /**
   * Re-fetch the data by re-running the effect
   */
  refetch: () => void;
}

/**
 * Query pattern with refetch capability.
 * Runs the effect immediately on mount and provides a refetch function.
 * Built on top of useEffect with immediate: true.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useQuery } from 'effect-svelte';
 *   import { Effect } from 'effect';
 *
 *   const query = useQuery(
 *     Effect.gen(function* () {
 *       const data = yield* fetchData();
 *       return data;
 *     })
 *   );
 * </script>
 *
 * <button onclick={query.refetch}>Refresh</button>
 *
 * {#if query.result._tag === 'success'}
 *   <p>Data: {JSON.stringify(query.result.value)}</p>
 * {/if}
 * ```
 */
export function useQuery<A, E, R>(effect: Effect.Effect<A, E, R>): UseQueryReturn<A, E> {
  const effectHook = useEffect(effect, { immediate: true });

  return {
    get result() {
      return effectHook.result;
    },
    refetch: effectHook.run,
  };
}
