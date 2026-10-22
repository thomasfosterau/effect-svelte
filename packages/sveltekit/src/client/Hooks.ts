/**
 * Effect wrappers for SvelteKit's client-side hooks (`src/hooks.client.ts`),
 * exposed as the `Hooks` namespace of `@thomasfosterau/effect-sveltekit/client`.
 *
 * These mirror the server hook helpers in `../server/Hooks.ts`, but run on the
 * client: there is no request context, so each effect runs on a bare Effect
 * runtime. For application services, run the effect through your own runtime
 * instead. Kept free of `$app/*` imports so it stays importable (and testable)
 * outside of a SvelteKit app.
 *
 * @example
 * ```ts
 * // src/hooks.client.ts
 * import { Hooks } from '@thomasfosterau/effect-sveltekit/client';
 * import { Effect } from 'effect';
 *
 * export const handleError = Hooks.handleError(({ error, event }) =>
 *   Effect.as(Effect.logError(`navigation to ${event.url.pathname} failed`, error), {
 *     message: 'Something went wrong',
 *   })
 * );
 * ```
 */

import type { ClientInit, HandleClientError } from "@sveltejs/kit/hooks";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { causeToThrowable } from "../internal/error.js";

/** Run a bare Effect (no request context) and settle it the way a hook expects. */
const runBareHook = async <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
  Exit.match(await Effect.runPromiseExit(effect), {
    onFailure: (cause) => {
      throw causeToThrowable(cause);
    },
    onSuccess: (value) => value,
  });

/**
 * Wraps an Effect-based function as the SvelteKit client
 * [`handleError`](https://svelte.dev/docs/kit/hooks#Shared-hooks-handleError)
 * hook, which runs when an unexpected error is thrown while navigating in the
 * browser. The effect receives the error and navigation event and produces the
 * shape exposed to the page (your `App.Error`, or nothing).
 *
 * @example
 * ```ts
 * // src/hooks.client.ts
 * import { Hooks } from '@thomasfosterau/effect-sveltekit/client';
 * import { Effect } from 'effect';
 *
 * export const handleError = Hooks.handleError(({ error, event }) =>
 *   Effect.gen(function* () {
 *     yield* Effect.logError(`navigation to ${event.url.pathname} failed`, error);
 *     return { message: 'Something went wrong' };
 *   })
 * );
 * ```
 */
export function handleError(
  fn: (
    args: Parameters<HandleClientError>[0],
  ) => Effect.Effect<Awaited<ReturnType<HandleClientError>>, unknown>,
): HandleClientError {
  return (args) => runBareHook(fn(args));
}

/**
 * Wraps an Effect as the SvelteKit client
 * [`init`](https://svelte.dev/docs/kit/hooks#Shared-hooks-init) hook, which
 * runs once when the app starts in the browser. The effect runs on a bare
 * Effect runtime.
 *
 * @example
 * ```ts
 * // src/hooks.client.ts
 * import { Hooks } from '@thomasfosterau/effect-sveltekit/client';
 * import { Effect } from 'effect';
 *
 * export const init = Hooks.init(Effect.logInfo('client app started'));
 * ```
 */
export function init(effect: Effect.Effect<void, unknown>): ClientInit {
  return () => runBareHook(effect);
}
