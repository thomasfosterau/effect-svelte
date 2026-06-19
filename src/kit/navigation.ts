/**
 * Effect wrappers for SvelteKit's client-side
 * [`$app/navigation`](https://svelte.dev/docs/kit/$app-navigation) API.
 *
 * Each of SvelteKit's promise-returning navigation functions is wrapped as an
 * `Effect`, so navigation composes inside Effect pipelines (sequencing,
 * retries, `Effect.race`, tracing spans, ...). These run on the client only —
 * calling them during SSR throws, exactly as the underlying `$app/navigation`
 * functions do.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { goto, invalidateAll } from '@thomasfosterau/effect-svelte/kit/client';
 *   import { Effect } from 'effect';
 *   import { getRuntime } from '@thomasfosterau/effect-svelte';
 *
 *   const runtime = getRuntime();
 *   const save = () =>
 *     runtime.runPromise(
 *       Effect.gen(function* () {
 *         yield* doSave();
 *         yield* invalidateAll();
 *         yield* goto('/done');
 *       }),
 *     );
 * </script>
 * ```
 */

import {
  goto as kitGoto,
  invalidate as kitInvalidate,
  invalidateAll as kitInvalidateAll,
  preloadCode as kitPreloadCode,
  preloadData as kitPreloadData,
  refreshAll as kitRefreshAll,
} from "$app/navigation";
import { Effect } from "effect";

/** Navigate to `url`. Wraps `$app/navigation`'s `goto`. */
export const goto = (...args: Parameters<typeof kitGoto>): Effect.Effect<void> =>
  Effect.promise(() => kitGoto(...args));

/** Re-run `load` functions that depend on `resource`. Wraps `invalidate`. */
export const invalidate = (...args: Parameters<typeof kitInvalidate>): Effect.Effect<void> =>
  Effect.promise(() => kitInvalidate(...args));

/** Re-run every `load` function for the active page. Wraps `invalidateAll`. */
export const invalidateAll = (): Effect.Effect<void> => Effect.promise(() => kitInvalidateAll());

/** Refresh active remote functions (and, by default, `load`s). Wraps `refreshAll`. */
export const refreshAll = (...args: Parameters<typeof kitRefreshAll>): Effect.Effect<void> =>
  Effect.promise(() => kitRefreshAll(...args));

/** Preload the data for `href`. Wraps `preloadData`. */
export const preloadData = (
  href: string,
): Effect.Effect<Awaited<ReturnType<typeof kitPreloadData>>> =>
  Effect.promise(() => kitPreloadData(href));

/** Preload the code for routes matching `pathname`. Wraps `preloadCode`. */
export const preloadCode = (pathname: string): Effect.Effect<void> =>
  Effect.promise(() => kitPreloadCode(pathname));
