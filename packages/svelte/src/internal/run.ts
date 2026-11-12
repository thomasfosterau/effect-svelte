import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";

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

/**
 * Whether `slot` holds exactly `value`, compared by identity (`===`) rather
 * than `Equal`: the hooks keep their current fiber (or subscription token) in
 * an `Option` slot and ask whether a settling run is still the current one.
 */
export const holds = <A>(slot: Option.Option<A>, value: A): boolean =>
  Option.isSome(slot) && slot.value === value;

/**
 * Where a hook keeps the fiber of its current run: `None` while nothing is
 * running. A plain mutable cell, so the rune-free helpers here can read and
 * replace it.
 */
export interface FiberSlot<A, E> {
  current: Option.Option<Fiber.Fiber<A, E>>;
}

/** An empty {@link FiberSlot}. */
export const emptyFiberSlot = <A, E>(): FiberSlot<A, E> => ({ current: Option.none() });

/** Interrupts the fiber in `slot`, if any, leaving it in the slot. */
export const interruptSlot = <A, E>(slot: FiberSlot<A, E>): void => {
  if (Option.isSome(slot.current)) interruptFiber(slot.current.value);
};

/**
 * Makes `fiber` the current run of `slot` and, once it exits, hands its exit
 * to `onExit` and empties the slot — unless another run (or a teardown that
 * emptied the slot) has replaced it by then, in which case the exit is dropped
 * so a superseded run never settles the hook's result.
 */
export const trackFiber =
  <R>(runtime: RuntimeLike<R>) =>
  <A, E>(
    slot: FiberSlot<A, E>,
    fiber: Fiber.Fiber<A, E>,
    onExit: (exit: Exit.Exit<A, E>) => void,
  ): void => {
    slot.current = Option.some(fiber);
    runFork(runtime)(
      Effect.gen(function* () {
        const exit = yield* Fiber.await(fiber);
        if (holds(slot.current, fiber)) {
          onExit(exit);
          slot.current = Option.none();
        }
      }),
    );
  };
