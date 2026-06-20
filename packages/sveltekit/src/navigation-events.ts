/**
 * SvelteKit's client-side
 * [`$app/navigation`](https://svelte.dev/docs/kit/$app-navigation) lifecycle
 * callbacks (`beforeNavigate`, `afterNavigate`, `onNavigate`) bridged to Effect.
 *
 * Unlike the promise-returning navigation functions in `./navigation.ts`, these
 * are **callback-registration** functions: they must be called *synchronously
 * during component initialization* (SvelteKit wires them to the component's
 * lifecycle). So `beforeNavigateStream` / `afterNavigateStream` register their
 * callback eagerly and feed an internal `Queue`, returning a `Stream` backed by
 * that queue — the same push-based bridge as `SignalEmitter` in
 * `@thomasfosterau/effect-svelte`. Call them at the top level of `<script>`,
 * exactly where you'd call the bare `beforeNavigate` / `afterNavigate`.
 *
 * These run on the client only — calling them during SSR throws, exactly as the
 * underlying `$app/navigation` functions do.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { afterNavigateStream } from '@thomasfosterau/effect-sveltekit/client';
 *   import { Stream, Effect } from 'effect';
 *   import { getRuntime } from '@thomasfosterau/effect-svelte';
 *
 *   // Register at init so the callback is wired to the component lifecycle.
 *   const navigations = afterNavigateStream();
 *
 *   getRuntime().runFork(
 *     Stream.runForEach(navigations, (nav) =>
 *       Effect.logInfo(`navigated: ${nav.to?.url.pathname}`),
 *     ),
 *   );
 * </script>
 * ```
 */

import {
  afterNavigate as kitAfterNavigate,
  beforeNavigate as kitBeforeNavigate,
  onNavigate as kitOnNavigate,
} from "$app/navigation";
import type { AfterNavigate, BeforeNavigate, OnNavigate } from "@sveltejs/kit";
import { Effect } from "effect";
import type { Stream } from "effect";
import { onNavigateWith, registeredStream } from "./internal/navigation-events.js";

/**
 * Registers a `beforeNavigate` callback and exposes every navigation about to
 * happen as an Effect `Stream`. Call during component initialization.
 */
export function beforeNavigateStream(): Stream.Stream<BeforeNavigate> {
  return registeredStream<BeforeNavigate>(kitBeforeNavigate);
}

/**
 * Registers an `afterNavigate` callback and exposes every completed navigation
 * (including the initial one) as an Effect `Stream`. Call during component
 * initialization.
 */
export function afterNavigateStream(): Stream.Stream<AfterNavigate> {
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
 *   import { onNavigate } from '@thomasfosterau/effect-sveltekit/client';
 *   import { Effect } from 'effect';
 *
 *   onNavigate((nav) =>
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
