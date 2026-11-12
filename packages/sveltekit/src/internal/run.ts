/**
 * This package's runtime edge: the only module that runs an Effect with no
 * services of its own.
 *
 * SvelteKit calls loads, actions, endpoints, hooks, `use:enhance` callbacks and
 * navigation callbacks as Promise / callback APIs, so something has to run the
 * caller's Effect there. Where the caller supplied a runtime the wrappers run
 * on it (`Effect.runPromiseWith(context)`, `ManagedRuntime.runPromise`);
 * where there is none, they call the runners below. Keeping every such call
 * here is what lets the `effect/effect-run-in-body` lint rule stay on for the
 * rest of the package (its one override in the root `vite.config.ts` names
 * this file).
 *
 * Universal: no `$app/*`, no `node:`.
 *
 * @internal
 */

import * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";

/**
 * Runs an Effect that needs no services, at the edge of a Promise API. The
 * promise resolves with the Effect's success and rejects with its failure
 * (a typed failure, a defect or an interruption alike).
 */
export const runPromise = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect);

/**
 * Runs an Effect that needs no services, at the edge of a Promise API, keeping
 * its `Exit`. The promise never rejects: a failure, defect or interruption is
 * the `Exit`'s `Cause`.
 */
export const runPromiseExit = <A, E>(effect: Effect.Effect<A, E>): Promise<Exit.Exit<A, E>> =>
  Effect.runPromiseExit(effect);

/**
 * Runs an Effect that needs no services and cannot suspend, at the edge of a
 * synchronous callback API (a registrar SvelteKit requires during component
 * initialisation). Throws if the Effect fails or reaches an asynchronous
 * boundary, so it is only for pure allocation such as `Queue.unbounded`.
 */
export const runSync = <A, E>(effect: Effect.Effect<A, E>): A => Effect.runSync(effect);
