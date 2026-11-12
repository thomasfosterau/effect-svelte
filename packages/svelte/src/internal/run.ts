import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as ManagedRuntime from "effect/ManagedRuntime";

/**
 * A runtime that the Svelte hooks can run effects against.
 *
 * Both a plain services context (e.g. `Context.empty()` or
 * `defaultSvelteRuntime`) and managed runtimes (e.g.
 * `SvelteRuntime.defaultRuntime` or the result of `SvelteRuntime.extend`)
 * are supported.
 */
export type RuntimeLike<R> = Context.Context<R> | ManagedRuntime.ManagedRuntime<R, never>;

/**
 * Forks an effect on the given runtime, returning the running fiber.
 * Dispatches to the correct API depending on the kind of runtime provided.
 */
export const runFork =
  <R>(runtime: RuntimeLike<R>) =>
  <A, E>(effect: Effect.Effect<A, E, R>): Fiber.Fiber<A, E> =>
    Context.isContext(runtime) ? Effect.runForkWith(runtime)(effect) : runtime.runFork(effect);

/**
 * Runs an effect synchronously on the given runtime.
 * Dispatches to the correct API depending on the kind of runtime provided.
 */
export const runSync =
  <R>(runtime: RuntimeLike<R>) =>
  <A, E>(effect: Effect.Effect<A, E, R>): A =>
    Context.isContext(runtime) ? Effect.runSyncWith(runtime)(effect) : runtime.runSync(effect);

/**
 * Runs an Effect that needs no services and cannot suspend, where no runtime
 * is in reach: a Svelte `$effect` teardown. Throws if the
 * Effect fails or reaches an asynchronous boundary, so it is only for work
 * that is synchronous by construction, such as closing a scope whose
 * finalizers are synchronous.
 *
 * This module is the package's runtime edge: Svelte calls in from non-Effect
 * code, and the runners here are the only place an Effect is run with no
 * caller-supplied runtime (the `effect/effect-run-in-body` lint rule is off
 * for this file alone).
 */
export const runSyncDefault = <A, E>(effect: Effect.Effect<A, E>): A => Effect.runSync(effect);

/**
 * Interrupts a fiber in the background without waiting for it to finish.
 *
 * Interruption must not be run with `runSync` because interrupting a fiber
 * that is suspended on an async operation cannot complete synchronously.
 */
export const interruptFiber = <A, E>(fiber: Fiber.Fiber<A, E>): void => {
  fiber.interruptUnsafe();
};
