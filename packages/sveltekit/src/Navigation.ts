/**
 * Effect wrappers for SvelteKit's client-side
 * [`$app/navigation`](https://svelte.dev/docs/kit/$app-navigation) API.
 *
 * Each of SvelteKit's promise-returning navigation functions is wrapped as an
 * `Effect`, so navigation composes inside Effect pipelines (sequencing,
 * retries, `Effect.race`, tracing spans, ...). Alongside them sit the
 * client-side lifecycle callbacks (`beforeNavigate`, `afterNavigate`,
 * `onNavigate`) bridged to Effect. These run on the client only.
 *
 * When SvelteKit rejects (for example, `goto` to a URL outside the app) or
 * throws (for example, any of them run during server rendering), the wrapper
 * fails with a {@link NavigationError} that names the operation and carries
 * SvelteKit's original reason as its `cause`.
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
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";
import { onNavigateWith, registeredStream } from "./internal/navigation-events.js";

/**
 * A `$app/navigation` promise wrapper ({@link goto}, {@link invalidate},
 * {@link invalidateAll}, {@link refreshAll}, {@link preloadData},
 * {@link preloadCode}) rejected or threw. `operation` names the wrapper and
 * `cause` is SvelteKit's original reason, unchanged.
 *
 * SvelteKit 3 rejects `goto` with a URL outside the app (external, or matching
 * no route) and `preloadData` with a URL outside the app; `invalidate` throws on
 * a `resource` that cannot be parsed even relative to the current URL;
 * `preloadCode` rejects when a route's code fails to load; a navigation (including one that follows a `load` redirect during
 * `invalidate` / `refreshAll`) rejects when a `beforeNavigate` / `onNavigate`
 * callback throws; and every one of them throws when called during server
 * rendering. Recover with `Effect.catchTag("NavigationError", ...)`.
 */
export class NavigationError extends Data.TaggedError("NavigationError")<{
  /** The wrapper whose SvelteKit call failed. */
  readonly operation:
    | "goto"
    | "invalidate"
    | "invalidateAll"
    | "refreshAll"
    | "preloadData"
    | "preloadCode";
  /** The rejection reason, or the value thrown, as SvelteKit produced it. */
  readonly cause: unknown;
}> {}

/**
 * Runs a `$app/navigation` call as an Effect, so a rejection, or a synchronous
 * throw, fails with a {@link NavigationError} instead of becoming a defect.
 */
const fromNavigation = <A>(
  operation: NavigationError["operation"],
  thunk: () => Promise<A>,
): Effect.Effect<A, NavigationError> =>
  Effect.tryPromise({
    try: () => thunk(),
    catch: (cause) => new NavigationError({ operation, cause }),
  });

/**
 * Navigate to `url`. Wraps `$app/navigation`'s `goto`.
 *
 * Fails with a {@link NavigationError} if SvelteKit rejects: a URL outside the
 * app (external, or not matching a route) rejects, as does a navigation whose
 * `beforeNavigate` / `onNavigate` callback throws, or a call during server
 * rendering. For an external URL, set `window.location` instead.
 */
export const goto = (...args: Parameters<typeof kitGoto>): Effect.Effect<void, NavigationError> =>
  fromNavigation("goto", () => kitGoto(...args));

/**
 * Re-run `load` functions that depend on `resource`. Wraps `invalidate`.
 *
 * Fails with a {@link NavigationError} if SvelteKit rejects or throws: a
 * `resource` string that cannot be parsed even relative to the current URL
 * throws, as does a call during server rendering, and the navigation that
 * follows a `load` redirect can reject.
 */
export const invalidate = (
  ...args: Parameters<typeof kitInvalidate>
): Effect.Effect<void, NavigationError> =>
  fromNavigation("invalidate", () => kitInvalidate(...args));

/**
 * Re-run every `load` function for the active page. Wraps `invalidateAll`.
 *
 * Fails with a {@link NavigationError} if SvelteKit rejects or throws: for
 * example, when the navigation that follows a `load` redirect fails, or when
 * called during server rendering.
 *
 * @deprecated SvelteKit 3 deprecates `invalidateAll`; use {@link refreshAll},
 * which also refreshes active remote functions and keeps `page.state`.
 */
export const invalidateAll = (): Effect.Effect<void, NavigationError> =>
  fromNavigation("invalidateAll", () => kitInvalidateAll());

/**
 * Refresh active remote functions (and, by default, `load`s). Wraps `refreshAll`.
 *
 * Fails with a {@link NavigationError} if SvelteKit rejects or throws: for
 * example, when the navigation that follows a `load` redirect fails, or when
 * called during server rendering.
 */
export const refreshAll = (
  ...args: Parameters<typeof kitRefreshAll>
): Effect.Effect<void, NavigationError> =>
  fromNavigation("refreshAll", () => kitRefreshAll(...args));

/**
 * Preload the data for `href`. Wraps `preloadData`, succeeding with SvelteKit's
 * result (`loaded`, `redirect`, or `error` when a `load` fails).
 *
 * Fails with a {@link NavigationError} if SvelteKit rejects: an `href` outside
 * the app rejects, as does a call during server rendering.
 */
export const preloadData = (
  href: string,
): Effect.Effect<Awaited<ReturnType<typeof kitPreloadData>>, NavigationError> =>
  fromNavigation("preloadData", () => kitPreloadData(href));

/**
 * Preload the code for the route `id` (e.g. `/blog/[slug]`, without
 * `paths.base`). Wraps `preloadCode`.
 *
 * Fails with a {@link NavigationError} if SvelteKit rejects: a route module
 * that fails to load rejects, as does a call during server rendering (and, in
 * development, an `id` not starting with `/`).
 */
export const preloadCode = (
  ...args: Parameters<typeof kitPreloadCode>
): Effect.Effect<void, NavigationError> =>
  fromNavigation("preloadCode", () => kitPreloadCode(...args));

/**
 * Registers a `beforeNavigate` callback and exposes every navigation about to
 * happen as an Effect `Stream`. Call during component initialization.
 *
 * Unlike the promise-returning navigation functions above, this is a
 * **callback-registration** function: it must be called *synchronously during
 * component initialization* (SvelteKit wires it to the component's lifecycle).
 * It registers its callback eagerly and feeds an internal unbounded `Queue`,
 * returning a `Stream` backed by that queue: a push-based bridge that buffers
 * every event for its single consumer. Call it at the top level of `<script>`,
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
