import type { Effect } from "effect";
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { useEffect } from "./effect.svelte.js";

export interface UseQueryReturn<A, E> {
  /**
   * The current result state of the query. Refetching preserves the previous
   * value as a waiting `Success` (stale-while-revalidate).
   */
  readonly current: AsyncResult.AsyncResult<A, E>;

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
 *   import { useQuery, AsyncResult } from '@thomasfosterau/effect-svelte';
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
 * {#if AsyncResult.isSuccess(query.current)}
 *   <p>Data: {JSON.stringify(query.current.value)}</p>
 * {/if}
 * ```
 */
export function useQuery<A, E, R>(effect: Effect.Effect<A, E, R>): UseQueryReturn<A, E> {
  const effectHook = useEffect(effect, { immediate: true });

  return {
    get current() {
      return effectHook.current;
    },
    refetch: effectHook.run,
  };
}
