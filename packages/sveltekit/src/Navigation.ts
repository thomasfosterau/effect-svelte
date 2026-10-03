/**
 * Effect wrappers for SvelteKit's client-side
 * [`$app/navigation`](https://svelte.dev/docs/kit/$app-navigation) API.
 *
 * Each of SvelteKit's promise-returning navigation functions is wrapped as an
 * `Effect`, so navigation composes inside Effect pipelines (sequencing,
 * retries, `Effect.race`, tracing spans, ...). Alongside them sit the
 * client-side lifecycle callbacks (`beforeNavigate`, `afterNavigate`,
 * `onNavigate`) bridged to Effect. These run on the client only — calling them
 * during SSR throws, exactly as the underlying `$app/navigation` functions do.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { Navigation } from '@thomasfosterau/effect-sveltekit/client';
 *   import { Effect } from 'effect';
 *   import { getRuntime } from '@thomasfosterau/effect-svelte';
 *
 *   const runtime = getRuntime();
 *   const save = () =>
 *     runtime.runPromise(
 *       Effect.gen(function* () {
 *         yield* doSave();
 *         yield* Navigation.refreshAll();
 *         yield* Navigation.goto('/done');
 *       }),
 *     );
 * </script>
 * ```
 */

import {
  afterNavigate as kitAfterNavigate,
  beforeNavigate as kitBeforeNavigate,
  goto as kitGoto,
  invalidate as kitInvalidate,
  invalidateAll as kitInvalidateAll,
  onNavigate as kitOnNavigate,
  preloadCode as kitPreloadCode,
  preloadData as kitPreloadData,
  refreshAll as kitRefreshAll,
} from "$app/navigation";
import type { AfterNavigate, BeforeNavigate, OnNavigate } from "$app/navigation";
import { Effect } from "effect";
import type { Stream } from "effect";
import { onNavigateWith, registeredStream } from "./internal/navigation-events.js";

/**
 * Navigate to `url`. Wraps `$app/navigation`'s `goto`. SvelteKit rejects a URL
 * outside the app (external, or not matching a route); a rejection surfaces as
 * a defect.
 */
export const goto = (...args: Parameters<typeof kitGoto>): Effect.Effect<void> =>
  Effect.promise(() => kitGoto(...args));

/** Re-run `load` functions that depend on `resource`. Wraps `invalidate`. */
export const invalidate = (...args: Parameters<typeof kitInvalidate>): Effect.Effect<void> =>
  Effect.promise(() => kitInvalidate(...args));

/**
 * Re-run every `load` function for the active page. Wraps `invalidateAll`.
 *
 * @deprecated SvelteKit 3 deprecates `invalidateAll`; use {@link refreshAll},
 * which also refreshes active remote functions and keeps `page.state`.
 */
export const invalidateAll = (): Effect.Effect<void> => Effect.promise(() => kitInvalidateAll());

/** Refresh active remote functions (and, by default, `load`s). Wraps `refreshAll`. */
export const refreshAll = (...args: Parameters<typeof kitRefreshAll>): Effect.Effect<void> =>
  Effect.promise(() => kitRefreshAll(...args));

/** Preload the data for `href`. Wraps `preloadData`. */
export const preloadData = (
  href: string,
): Effect.Effect<Awaited<ReturnType<typeof kitPreloadData>>> =>
  Effect.promise(() => kitPreloadData(href));

/**
 * Preload the code for the route `id` (e.g. `/blog/[slug]`, without
 * `paths.base`). Wraps `preloadCode`.
 */
export const preloadCode = (...args: Parameters<typeof kitPreloadCode>): Effect.Effect<void> =>
  Effect.promise(() => kitPreloadCode(...args));

/**
 * Registers a `beforeNavigate` callback and exposes every navigation about to
 * happen as an Effect `Stream`. Call during component initialization.
 *
 * Unlike the promise-returning navigation functions above, this is a
 * **callback-registration** function: it must be called *synchronously during
 * component initialization* (SvelteKit wires it to the component's lifecycle).
 * It registers its callback eagerly and feeds an internal `Queue`, returning a
 * `Stream` backed by that queue — the same push-based bridge as `SignalEmitter`
 * in `@thomasfosterau/effect-svelte`. Call it at the top level of `<script>`,
 * exactly where you'd call the bare `beforeNavigate`.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { Navigation } from '@thomasfosterau/effect-sveltekit/client';
 *   import { Stream, Effect } from 'effect';
 *   import { getRuntime } from '@thomasfosterau/effect-svelte';
 *
 *   // Register at init so the callback is wired to the component lifecycle.
 *   const navigations = Navigation.beforeNavigate();
 *
 *   getRuntime().runFork(
 *     Stream.runForEach(navigations, (nav) =>
 *       Effect.logInfo(`leaving: ${nav.from?.url.pathname}`),
 *     ),
 *   );
 * </script>
 * ```
 */
export function beforeNavigate(): Stream.Stream<BeforeNavigate> {
  return registeredStream<BeforeNavigate>(kitBeforeNavigate);
}

/**
 * Registers an `afterNavigate` callback and exposes every completed navigation
 * (including the initial one) as an Effect `Stream`. Call during component
 * initialization.
 *
 * Like {@link beforeNavigate}, this is a **callback-registration** function:
 * call it at the top level of `<script>`, exactly where you'd call the bare
 * `afterNavigate`.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { Navigation } from '@thomasfosterau/effect-sveltekit/client';
 *   import { Stream, Effect } from 'effect';
 *   import { getRuntime } from '@thomasfosterau/effect-svelte';
 *
 *   // Register at init so the callback is wired to the component lifecycle.
 *   const navigations = Navigation.afterNavigate();
 *
 *   getRuntime().runFork(
 *     Stream.runForEach(navigations, (nav) =>
 *       Effect.logInfo(`navigated: ${nav.to?.url.pathname}`),
 *     ),
 *   );
 * </script>
 * ```
 */
export function afterNavigate(): Stream.Stream<AfterNavigate> {
  return registeredStream<AfterNavigate>(kitAfterNavigate);
}

/**
 * Runs an `Effect` for each navigation, registered via `$app/navigation`'s
 * `onNavigate`. Call during component initialization.
 *
 * SvelteKit's `onNavigate` callback may return a cleanup function (or a promise
 * of one) that runs once the navigation completes and the DOM has updated; to
 * support that, `fn`'s Effect may succeed with a `() => void` cleanup, which is
 * forwarded to SvelteKit. The Effect is run with `runEffect` (default
 * {@link Effect.runPromise}); pass a managed runtime's `runPromise` to supply
 * services to `fn`.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { Navigation } from '@thomasfosterau/effect-sveltekit/client';
 *   import { Effect } from 'effect';
 *
 *   Navigation.onNavigate((nav) =>
 *     Effect.gen(function* () {
 *       yield* Effect.logInfo(`navigating to ${nav.to?.url.pathname}`);
 *       // Optionally return a cleanup that runs after the navigation:
 *       return () => console.log("navigation done");
 *     }),
 *   );
 * </script>
 * ```
 */
export function onNavigate(
  fn: (navigation: OnNavigate) => Effect.Effect<(() => void) | void>,
  runEffect: <X>(effect: Effect.Effect<X>) => Promise<X> = Effect.runPromise,
): void {
  onNavigateWith<OnNavigate>(kitOnNavigate, fn, runEffect);
}
