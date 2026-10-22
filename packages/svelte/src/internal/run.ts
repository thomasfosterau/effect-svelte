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
 * Interrupts a fiber in the background without waiting for it to finish.
 *
 * Interruption must not be run with `runSync` because interrupting a fiber
 * that is suspended on an async operation cannot complete synchronously.
 */
export const interruptFiber = <A, E>(fiber: Fiber.Fiber<A, E>): void => {
  fiber.interruptUnsafe();
};
