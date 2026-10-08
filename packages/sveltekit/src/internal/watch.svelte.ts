/**
 * The one runes-dependent piece of the `$app/state` bridge: watch a reactive
 * read outside any component.
 *
 * `$app/state`'s `page` / `navigating` / `updated` are rune-backed, and Svelte
 * offers no rune-free way to observe a signal, so this module is a `.svelte.ts`
 * file (kept as `.svelte.js` in `dist/`, where the consumer's Svelte compiler
 * processes it). Everything else lives in the rune-free `app-state.ts`,
 * parameterised over {@link watch}, so it can be unit-tested in plain Node.
 *
 * @internal
 */

import { untrack } from "svelte";

/**
 * Calls `onValue` with `read()` on the next Svelte flush, then again each time
 * a reactive value `read` touched changes. The effect lives in its own
 * `$effect.root`, so it needs no component context; the returned function
 * destroys it. On the server Svelte never runs effects, so `onValue` is never
 * called there.
 */
export function watch<A>(read: () => A, onValue: (value: A) => void): () => void {
  return $effect.root(() => {
    $effect(() => {
      const value = read();
      // Only `read` should be tracked; delivering the value must not subscribe
      // the effect to anything the consumer happens to touch.
      untrack(() => onValue(value));
    });
  });
}
