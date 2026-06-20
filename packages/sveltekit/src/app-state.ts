/**
 * A minimal Effect-side bridge for SvelteKit's
 * [`$app/state`](https://svelte.dev/docs/kit/$app-state) `page`.
 *
 * `$app/state` exposes rune-reactive `page` / `navigating` / `updated` for use
 * inside components. This bridges `page` to an Effect `Stream` so navigation can
 * drive Effect pipelines without touching Svelte runes: it emits the current
 * `page` immediately, then again after each navigation, by registering
 * `afterNavigate` (from `$app/navigation`) and reading `page` (from
 * `$app/state`) at callback time.
 *
 * Each emission is a *shallow snapshot* (`url`, `params`, `route`, `data`,
 * `status`, `error`, `form`, `state`) rather than the live `$app/state` proxy:
 * the proxy mutates in place on every navigation, so a captured reference is
 * unreliable for downstream consumers — the snapshot gives each emission a
 * stable value. Reading at `afterNavigate` time also avoids needing a `.svelte`
 * runes file.
 *
 * Like the navigation-event helpers, `pageStream` registers its callback during
 * component initialization (where `$app/navigation` requires), so call it at the
 * top level of `<script>`. Client-only.
 *
 * NOTE: this is intentionally minimal. A richer reactive bridge (a `CurrentPage`
 * service readable from any Effect, `navigating` / `updated` streams) may later
 * compose with the official `@effect/atom-svelte` integration (see issue #23)
 * rather than re-implementing runes plumbing here.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { pageStream } from '@thomasfosterau/effect-sveltekit/client';
 *   import { Stream, Effect } from 'effect';
 *   import { getRuntime } from '@thomasfosterau/effect-svelte';
 *
 *   const pages = pageStream();
 *   getRuntime().runFork(
 *     Stream.runForEach(pages, (page) =>
 *       Effect.logInfo(`page: ${page.url.pathname}`),
 *     ),
 *   );
 * </script>
 * ```
 */

import { afterNavigate as kitAfterNavigate } from "$app/navigation";
import { page as kitPage } from "$app/state";
import type { Page } from "@sveltejs/kit";
import type { Stream } from "effect";
import { type PageSnapshot, pageSnapshotStream } from "./internal/app-state.js";

/** A shallow snapshot of SvelteKit's `page` — see {@link pageStream}. */
export type { PageSnapshot } from "./internal/app-state.js";

/**
 * A `Stream` of the current SvelteKit `page`, emitting a shallow snapshot
 * immediately and again after every navigation. Call during component
 * initialization.
 */
export function pageStream(): Stream.Stream<PageSnapshot<Page>> {
  return pageSnapshotStream<Page>(
    (callback) => {
      kitAfterNavigate(() => {
        callback();
      });
    },
    () => kitPage,
  );
}
