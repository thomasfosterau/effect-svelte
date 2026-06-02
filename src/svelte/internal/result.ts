import { untrack } from "svelte";
import type { AsyncResult } from "../types.js";

/**
 * Mutates `target` in place so that it matches `next`.
 *
 * Hooks that return an `AsyncResult` directly (such as `derived` and
 * `reactiveQuery`) hand the caller a reference to a `$state` proxy. Svelte
 * tracks property-level changes on that proxy, but it cannot track a
 * reassignment of the local variable holding it — the caller would keep
 * observing the original object forever. Updating state by mutating the
 * proxy keeps the returned reference reactive.
 *
 * The mutation is wrapped in `untrack` because it both reads (Object.keys)
 * and writes the proxy: hooks call it from inside their own `$effect`, and
 * without untracking, the effect would register the proxy as a dependency of
 * itself and re-run (interrupting and restarting its fiber) every time the
 * fiber delivers a result.
 */
export const assignResult = <A, E>(
  target: Record<string, unknown>,
  next: AsyncResult<A, E>,
): void => {
  untrack(() => {
    for (const key of Object.keys(target)) {
      if (!(key in next)) {
        delete target[key];
      }
    }
    Object.assign(target, next);
  });
};
