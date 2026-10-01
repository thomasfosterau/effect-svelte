import type { RemoteResource } from "@sveltejs/kit";
import * as AsyncResult from "effect/reactivity/AsyncResult";

/**
 * Bridges a SvelteKit remote resource (`query(...)`, `query.live(...)`,
 * `prerender(...)`) into Effect's native
 * {@link AsyncResult.AsyncResult} — the same result type the Svelte hooks in
 * `@thomasfosterau/effect-svelte` expose — so remote-function data folds into
 * the same templates and combinators (`AsyncResult.match`, `isSuccess`, ...).
 *
 * A `RemoteResource<T>` is already reactive (`current` / `loading` / `error` /
 * `ready`); reading them inside the returned `current` getter tracks them, so
 * the result updates as the resource does. The `loading` flag is surfaced as
 * `AsyncResult`'s `waiting` (stale-while-revalidate): a refresh keeps the
 * previous `Success` on screen.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useRemoteQuery } from '@thomasfosterau/effect-sveltekit/client';
 *   import { AsyncResult } from '@thomasfosterau/effect-svelte';
 *   import { getTodos } from './todos.remote';
 *
 *   const todos = useRemoteQuery(getTodos());
 * </script>
 *
 * {#if AsyncResult.isSuccess(todos.current)}
 *   <ul>{#each todos.current.value as todo}<li>{todo.text}</li>{/each}</ul>
 * {/if}
 * ```
 */
export function useRemoteQuery<T>(query: RemoteResource<T>): {
  readonly current: AsyncResult.AsyncResult<T, unknown>;
} {
  return {
    get current() {
      // Read every reactive field so the consumer's effect tracks the resource.
      const loading = query.loading;
      const error = query.error;
      const ready = query.ready;

      if (error !== undefined && error !== null) {
        return AsyncResult.fail<unknown, T>(error, { waiting: loading });
      }
      if (ready) {
        return AsyncResult.success<T, unknown>(query.current as T, { waiting: loading });
      }
      return AsyncResult.initial<T, unknown>(loading);
    },
  };
}
