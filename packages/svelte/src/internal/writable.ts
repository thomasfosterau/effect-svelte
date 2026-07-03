import { SubscriptionRef } from "effect";
import { runFork, type RuntimeLike } from "./run.js";

/**
 * The imperative write half of a two-way `SubscriptionRef` binding, factored
 * out of the rune wrapper so the write semantics can be unit-tested without a
 * Svelte component context.
 *
 * Both `set` and `update` fork the write onto the runtime and return
 * immediately — the value the caller sees update is driven by the ref's
 * `changes` stream (or, in the rune wrapper, an optimistic local assignment).
 */
export interface RefWriter<A> {
  /** Replace the ref's value. */
  readonly set: (value: A) => void;
  /** Apply a function to the ref's current value. */
  readonly update: (f: (current: A) => A) => void;
}

/**
 * Build a {@link RefWriter} for a `SubscriptionRef`, running writes on the
 * given runtime.
 */
export function refWriter<A, R = never>(
  runtime: RuntimeLike<R>,
  ref: SubscriptionRef.SubscriptionRef<A>,
): RefWriter<A> {
  return {
    set: (value) => {
      runFork(runtime)(SubscriptionRef.set(ref, value));
    },
    update: (f) => {
      runFork(runtime)(SubscriptionRef.update(ref, f));
    },
  };
}
