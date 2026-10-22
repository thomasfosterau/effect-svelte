/**
 * An Effect-side bridge for SvelteKit's
 * [`$app/state`](https://svelte.dev/docs/kit/$app-state): `page`, `navigating`
 * and `updated`.
 *
 * `$app/state` exposes rune-reactive objects for use inside components. This
 * module turns them into Effect values so navigation and version state can
 * drive Effect pipelines without touching Svelte runes:
 *
 * - {@link page} — a `Stream` of page snapshots, emitted now and after each
 *   navigation (via `afterNavigate`, so call it during component
 *   initialization).
 * - {@link navigating} — a `Stream` of the in-flight navigation as an
 *   `Option` (`None` when idle).
 * - {@link updated} / {@link checkForUpdate} — whether a new app version has
 *   been deployed, as a `Stream<boolean>` and as an on-demand check.
 * - {@link CurrentPage} — a `Context` service exposing the current page to any
 *   client Effect; provide {@link CurrentPage.layer} in your client runtime.
 *
 * Each page emission is a *shallow snapshot* (`url`, `params`, `route`, `data`,
 * `status`, `error`, `form`, `state`, `shallow`) rather than the live
 * `$app/state` proxy: the proxy mutates in place on every navigation, so a
 * captured reference is unreliable for downstream consumers — the snapshot
 * gives each emission a stable value. `navigating` emissions are snapshots for
 * the same reason.
 *
 * `navigating`, `updated` and `CurrentPage.changes` watch the rune state with a
 * root `$effect`, so they work anywhere on the client (not only during
 * component initialization). Each stream is cold: a run opens its own watcher,
 * emits the current value on the next Svelte flush and again whenever it
 * changes, and disposes the watcher when the stream ends or is interrupted.
 * All of this is client-only: during server rendering the watched streams
 * never emit, so consuming one there (for example with `Stream.runHead`)
 * hangs rather than failing.
 *
 * These are streams and a service rather than atoms; an atom-based variant
 * may follow once the official `@effect/atom-svelte` integration lands (see
 * issue #23).
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { State } from '@thomasfosterau/effect-sveltekit/client';
 *   import { Stream, Effect } from 'effect';
 *   import { getRuntime } from '@thomasfosterau/effect-svelte';
 *
 *   const pages = State.page();
 *   getRuntime().runFork(
 *     Stream.runForEach(pages, (page) =>
 *       Effect.logInfo(`page: ${page.url.pathname}`),
 *     ),
 *   );
 * </script>
 * ```
 */

import { afterNavigate as kitAfterNavigate } from "$app/navigation";
import { navigating as kitNavigating, page as kitPage, updated as kitUpdated } from "$app/state";
import type { Page } from "$app/state";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type * as Stream from "effect/Stream";
import {
  type CurrentPageService,
  type NavigatingSnapshot,
  type PageSnapshot,
  type UpdateCheckError,
  checkForUpdateWith,
  makeCurrentPage,
  pageSnapshotStream,
  snapshotNavigating,
  watchedStream,
} from "./internal/app-state.js";
import { watch } from "./internal/watch.svelte.js";

/** A shallow snapshot of SvelteKit's `page` — see {@link page}. */
export type { PageSnapshot } from "./internal/app-state.js";

/**
 * A snapshot of an in-flight SvelteKit navigation (`type`, `from`, `to`,
 * `willUnload`, `delta`, `complete`) — see {@link navigating}.
 */
export type { NavigatingSnapshot } from "./internal/app-state.js";

/**
 * The error {@link checkForUpdate} fails with when SvelteKit's
 * `updated.check()` rejects (misuse such as calling it during server
 * rendering; a failed version request resolves `false` instead). The original
 * error is on `cause`.
 */
export { UpdateCheckError } from "./internal/app-state.js";

/**
 * A `Stream` of the current SvelteKit `page`, emitting a shallow snapshot
 * immediately and again after every navigation; never fails. Call during
 * component initialization. It follows `afterNavigate`, so page changes
 * without a navigation (shallow routing, form results) don't emit — use
 * {@link CurrentPage}'s `changes` for those.
 */
export function page(): Stream.Stream<PageSnapshot<Page>> {
  return pageSnapshotStream<Page>(
    (callback) => {
      kitAfterNavigate(() => {
        callback();
      });
    },
    () => kitPage,
  );
}

/**
 * A `Stream` of SvelteKit's in-flight navigation: `Option.some` with a
 * {@link NavigatingSnapshot} while a navigation is in progress, `Option.none()`
 * when idle. Emits the current state on the next Svelte flush, then on every
 * change; never fails. Client-only, but callable anywhere (not only during
 * component initialization).
 *
 * @example
 * ```ts
 * const spinner = Stream.runForEach(State.navigating(), (nav) =>
 *   Effect.sync(() => (busy = Option.isSome(nav))),
 * );
 * ```
 */
export function navigating(): Stream.Stream<Option.Option<NavigatingSnapshot>> {
  return watchedStream(watch, () => snapshotNavigating(kitNavigating));
}

/**
 * A `Stream` of SvelteKit's `updated.current`: whether a new version of the app
 * has been deployed since this one loaded. Emits the current value on the next
 * Svelte flush, then on every change (SvelteKit only ever flips it from `false`
 * to `true`); never fails. Client-only, but callable anywhere.
 */
export function updated(): Stream.Stream<boolean> {
  return watchedStream(watch, () => kitUpdated.current);
}

/**
 * Asks SvelteKit to check for a new app version now (`updated.check()`),
 * succeeding with whether one is available; a positive result also flips
 * {@link updated}. Always succeeds with `false` in development. Fails with
 * {@link UpdateCheckError} if the check rejects. Client-only.
 */
export function checkForUpdate(): Effect.Effect<boolean, UpdateCheckError> {
  return checkForUpdateWith(() => kitUpdated.check());
}

/**
 * The service shape of {@link CurrentPage}: `get` snapshots the current page
 * and `changes` streams it. Neither fails on the client; see
 * {@link CurrentPage} for the server.
 */
export interface CurrentPageInterface extends CurrentPageService<Page> {}

/**
 * The current SvelteKit page as an Effect service, so any client Effect can read
 * it with `yield* State.CurrentPage` instead of taking it as an argument.
 * `get` snapshots the page when run; `changes` emits the current page on the
 * next Svelte flush, then a fresh snapshot whenever any field changes
 * (navigations, but also shallow routing and form results). Neither fails on
 * the client; on the server, Kit's `page` throws outside synchronous component
 * rendering (including after an async boundary in an Effect forked during
 * render), so `get` dies with a defect there.
 *
 * Provide {@link CurrentPage.layer} (backed by `$app/state`) in your client
 * runtime, or `Layer.succeed(State.CurrentPage, …)` in tests.
 *
 * @example
 * ```ts
 * const trackView = Effect.gen(function* () {
 *   const page = yield* (yield* State.CurrentPage).get;
 *   yield* analytics.view(page.url.pathname);
 * });
 *
 * runtime.runFork(trackView.pipe(Effect.provide(State.CurrentPage.layer)));
 * ```
 */
export class CurrentPage extends Context.Service<CurrentPage, CurrentPageInterface>()(
  "@thomasfosterau/effect-sveltekit/CurrentPage",
) {
  /**
   * A layer providing {@link CurrentPage} from `$app/state`'s `page`. Builds
   * instantly and never fails; client-only (during server rendering `changes`
   * never emits, so consuming it there hangs).
   */
  static readonly layer: Layer.Layer<CurrentPage> = Layer.succeed(
    CurrentPage,
    makeCurrentPage(() => kitPage, watch),
  );
}
