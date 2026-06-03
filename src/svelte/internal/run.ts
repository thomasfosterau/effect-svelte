import { Effect, Fiber, FiberId, ManagedRuntime, Runtime } from "effect";

/**
 * A runtime that the Svelte hooks can run effects against.
 *
 * Both plain runtimes (e.g. `Runtime.defaultRuntime`) and managed runtimes
 * (e.g. `SvelteRuntime.defaultRuntime` or the result of `SvelteRuntime.extend`)
 * are supported.
 */
export type RuntimeLike<R> = Runtime.Runtime<R> | ManagedRuntime.ManagedRuntime<R, never>;

/**
 * Forks an effect on the given runtime, returning the running fiber.
 * Dispatches to the correct API depending on the kind of runtime provided.
 */
export const runFork =
  <R>(runtime: RuntimeLike<R>) =>
  <A, E>(effect: Effect.Effect<A, E, R>): Fiber.RuntimeFiber<A, E> =>
    ManagedRuntime.isManagedRuntime(runtime)
      ? (runtime as ManagedRuntime.ManagedRuntime<R, never>).runFork(effect)
      : Runtime.runFork(runtime as Runtime.Runtime<R>)(effect);

/**
 * Runs an effect synchronously on the given runtime.
 * Dispatches to the correct API depending on the kind of runtime provided.
 */
export const runSync =
  <R>(runtime: RuntimeLike<R>) =>
  <A, E>(effect: Effect.Effect<A, E, R>): A =>
    ManagedRuntime.isManagedRuntime(runtime)
      ? (runtime as ManagedRuntime.ManagedRuntime<R, never>).runSync(effect)
      : Runtime.runSync(runtime as Runtime.Runtime<R>)(effect);

/**
 * Interrupts a fiber in the background without waiting for it to finish.
 *
 * Interruption must not be run with `runSync` because interrupting a fiber
 * that is suspended on an async operation cannot complete synchronously.
 */
export const interruptFiber = <A, E>(fiber: Fiber.RuntimeFiber<A, E>): void => {
  fiber.unsafeInterruptAsFork(FiberId.none);
};
