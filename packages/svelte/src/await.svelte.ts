import type { Effect } from "effect";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import { resultToPromise } from "./internal/await.js";
import type { RuntimeLike } from "./internal/run.js";
import { useQuery } from "./query.svelte.js";

export interface UseQueryPromiseOptions<R> {
  /**
   * Run against this runtime instead of the ambient context. When provided, the
   * effect's `R` is constrained to what the runtime provides.
   */
  readonly runtime?: RuntimeLike<R>;
}

export interface UseQueryPromiseReturn<A, E> {
  /** The underlying query result state (same as {@link useQuery}). */
  readonly current: AsyncResult.AsyncResult<A, E>;

  /**
   * A `Promise` reflecting `current`, for use with Svelte's `{#await}` (or
   * `<svelte:boundary>`). Its identity is stable until the result transitions:
   * pending while loading, resolved with the (possibly stale) value, rejected
   * on failure.
   */
  readonly promise: Promise<A>;

  /** Re-run the effect. A new `promise` is produced as the result transitions. */
  readonly refetch: () => void;
}

/**
 * Run an effect and bridge its result to Svelte 5's native async, so you can
 * render it with an `{#await}` block instead of `AsyncResult.match`.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useQueryPromise } from '@thomasfosterau/effect-svelte';
 *   import { Effect } from 'effect';
 *
 *   const user = useQueryPromise(fetchUser(1));
 * </script>
 *
 * {#await user.promise}
 *   <p>Loading…</p>
 * {:then value}
 *   <p>{value.name}</p>
 * {:catch error}
 *   <p>Failed: {error.message}</p>
 * {/await}
 *
 * <button onclick={user.refetch}>Reload</button>
 * ```
 */
export function useQueryPromise<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options: UseQueryPromiseOptions<R> = {},
): UseQueryPromiseReturn<A, E> {
  const query = useQuery(effect, options);

  // Recompute (and only then hand `{#await}` a new promise) when the underlying
  // result transitions — not on every unrelated re-render.
  const promise = $derived(resultToPromise(query.current));

  return {
    get current() {
      return query.current;
    },
    get promise() {
      return promise;
    },
    refetch: query.refetch,
  };
}
