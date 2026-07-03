import type { Effect } from "effect";
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { useEffect } from "./effect.svelte.js";
import type { RuntimeLike } from "./internal/run.js";

export interface UseQueryOptions<R> {
  /**
   * Run against this runtime instead of the ambient context. When provided, the
   * effect's `R` is constrained to what the runtime provides.
   */
  readonly runtime?: RuntimeLike<R>;
}

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

  /**
   * Optimistically overwrite the query's data locally without refetching.
   * Accepts a value or an updater over the current value (`undefined` if none
   * yet). The next `refetch` reconciles it with the server.
   */
  setData: (updater: A | ((previous: A | undefined) => A)) => void;

  /**
   * `true` while showing a previous value during a refetch
   * (stale-while-revalidate).
   */
  readonly isStale: boolean;
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
export function useQuery<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options: UseQueryOptions<R> = {},
): UseQueryReturn<A, E> {
  const effectHook = useEffect(effect, { immediate: true, ...options });

  return {
    get current() {
      return effectHook.current;
    },
    refetch: effectHook.run,
    setData: effectHook.setData,
    get isStale() {
      return effectHook.isStale;
    },
  };
}
