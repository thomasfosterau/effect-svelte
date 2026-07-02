import { Effect, Stream, SubscriptionRef } from "effect";
import { getRuntime } from "./context.svelte.js";
import { interruptFiber, runFork, runSync, type RuntimeLike } from "./internal/run.js";
import { refWriter } from "./internal/writable.js";

export interface UseWritableRefReturn<A> {
  /**
   * The current value of the `SubscriptionRef`. Reading tracks it reactively;
   * assigning writes back to the ref, so this property is usable directly with
   * Svelte's `bind:` directive (e.g. `bind:value={name.current}`).
   */
  current: A;

  /** Replace the ref's value. */
  readonly set: (value: A) => void;

  /** Apply a function to the ref's current value. */
  readonly update: (f: (current: A) => A) => void;
}

/**
 * Two-way binding between an Effect `SubscriptionRef` and Svelte runes.
 *
 * Unlike {@link useSubscriptionRef} (read-only `{ current }`), this hook exposes
 * a writable `current` — reading tracks the ref reactively and assigning writes
 * back — so Effect-managed state can drive `bind:value` for shared form / app
 * state. `set` and `update` are also provided for imperative writes.
 *
 * Local writes update `current` optimistically (so `bind:` does not glitch) and
 * are reconciled by the ref's `changes` stream, which also delivers updates
 * made elsewhere in the application.
 *
 * A `SubscriptionRef` is required (not a plain `Ref`): only a `SubscriptionRef`
 * exposes the `changes` stream needed to observe external updates reactively.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useWritableRef } from '@thomasfosterau/effect-svelte';
 *   import { SubscriptionRef } from 'effect';
 *
 *   // Assume nameRef is a SubscriptionRef<string> from shared app state
 *   const name = useWritableRef(nameRef);
 * </script>
 *
 * <input bind:value={name.current} />
 * <button onclick={() => name.set("")}>Clear</button>
 * ```
 */
export function useWritableRef<A>(
  ref: SubscriptionRef.SubscriptionRef<A>,
): UseWritableRefReturn<A> {
  const runtime = getRuntime() as RuntimeLike<never>;

  // Read the initial value synchronously so it is available before (and during
  // SSR, instead of) the subscription.
  let value = $state(runSync(runtime)(SubscriptionRef.get(ref)));

  const writer = refWriter(runtime, ref);

  const set = (next: A): void => {
    // Optimistic local update so `bind:value` reflects the change immediately,
    // then persist to the ref (whose `changes` stream reconciles the value).
    value = next;
    writer.set(next);
  };

  const update = (f: (current: A) => A): void => {
    set(f(value));
  };

  // Keep `value` in sync with updates made anywhere else in the app. The
  // `changes` stream re-emits the current value on subscribe, so no update is
  // missed between the synchronous initial read and the subscription starting.
  $effect(() => {
    const fiber = runFork(runtime)(
      Stream.runForEach(SubscriptionRef.changes(ref), (next) =>
        Effect.sync(() => {
          value = next;
        }),
      ),
    );
    return () => interruptFiber(fiber);
  });

  return {
    get current() {
      return value;
    },
    set current(next: A) {
      set(next);
    },
    set,
    update,
  };
}
