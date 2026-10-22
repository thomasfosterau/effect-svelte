/**
 * Helpers for SvelteKit's streamed (deferred-promise) `serverLoad` data.
 *
 * SvelteKit can stream fields of a `load` return value to the browser as they
 * resolve when you return a `Promise` alongside eagerly-computed fields. This
 * module provides {@link defer} — an Effect that captures the current service
 * context and launches the slow effect in the background, handing SvelteKit
 * the resulting `Promise`.
 *
 * @example
 * ```ts
 * import { serverLoad, defer } from '@thomasfosterau/effect-sveltekit/server';
 * import { Effect } from 'effect';
 *
 * export const load = serverLoad((event) =>
 *   Effect.gen(function* () {
 *     // Eager: resolved before the initial HTML is sent.
 *     const title = yield* fetchTitle(event.params.id);
 *
 *     // Deferred: SvelteKit streams this to the client as it resolves.
 *     const commentsPromise = yield* defer(fetchComments(event.params.id));
 *
 *     return { title, comments: commentsPromise };
 *   }),
 * );
 * ```
 *
 * In `+page.svelte`, consume the deferred field with `{#await}`:
 *
 * ```svelte
 * <script>
 *   let { data } = $props();
 * </script>
 *
 * <h1>{data.title}</h1>
 *
 * {#await data.comments}
 *   <p>Loading comments…</p>
 * {:then comments}
 *   {#each comments as c}<p>{c.body}</p>{/each}
 * {:catch}
 *   <p>Failed to load comments.</p>
 * {/await}
 * ```
 *
 * **Error handling.** If the deferred Effect fails, the promise rejects.
 * SvelteKit surfaces the rejection in the `{:catch}` block of `{#await}` in
 * the component — it does *not* throw the page into its error boundary. To
 * provide a fallback value instead, apply `Effect.orElse` / `Effect.catchAll`
 * before passing the effect to `defer`.
 */

import * as Effect from "effect/Effect";

/**
 * Capture the current service context and run `effect` in the background,
 * returning the `Promise` immediately so SvelteKit can stream the result.
 *
 * The deferred effect runs with exactly the same services as the parent
 * `serverLoad` handler — you can `yield*` the same application services.
 *
 * @param effect - The slow Effect to run in the background. Failures cause the
 *   returned Promise to reject; wrap with `Effect.orElse` for a fallback.
 *
 * @example
 * ```ts
 * const commentsPromise = yield* defer(fetchComments(id));
 * return { title, comments: commentsPromise };
 * ```
 */
export const defer = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<Promise<A>, never, R> =>
  Effect.map(Effect.context<R>(), (ctx) => Effect.runPromiseWith(ctx)(effect));
