import { Option, type Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { untrack } from "svelte";
import { getRuntime } from "./context.svelte.js";
import { resultToPromise } from "./internal/await.js";
import { makeLiveStream, type LiveResultState } from "./internal/live-stream.js";
import type { RuntimeLike } from "./internal/run.js";

export interface UseLiveStreamOptions<A, R> {
  /**
   * Run against this runtime instead of the ambient context. When provided, the
   * stream's `R` is constrained to what the runtime provides (a service-typed
   * `ManagedRuntime` gives a fully-checked `R`).
   */
  readonly runtime?: RuntimeLike<R>;

  /**
   * A synchronous seed value. When provided, `current` starts as a non-waiting
   * `Success(initial)` (and `promise` starts already-resolved) instead of
   * `Initial`, so server renders and the first client render show the data the
   * server already had — the first real emission then replaces it. This is the
   * SSR seam: without a synchronous seed, SSR output and the first client render
   * would show empty state and hydration would mismatch.
   */
  readonly initial?: A;
}

export interface UseLiveStreamReturn<A, E> {
  /**
   * The latest emission as an {@link AsyncResult.AsyncResult}. Each emission
   * replaces the previous value (never appends). While re-subscribing after a
   * reactive-input change the previous value stays visible as a waiting
   * `Success` (stale-while-revalidate). Held in `$state.raw`, so a large array's
   * reference identity is preserved for downstream dedup.
   */
  readonly current: AsyncResult.AsyncResult<A, E>;

  /**
   * A reactive `Promise` reflecting `current`, for `{#await}`-free async
   * templates (`experimental.async` + `<svelte:boundary>`). Pending until the
   * first emission, then replaced with an already-resolved promise on every
   * subsequent emission (no pending flash after first load); failures reject it.
   * With `initial` it starts already-resolved, so seeded pages never suspend
   * during SSR.
   */
  readonly promise: Promise<A>;
}

/**
 * A rune-backed {@link LiveResultState}. Holds the result in `$state.raw`:
 * emissions can be large arrays whose reference equality is meaningful
 * downstream, so deep proxying would break dedup and waste work.
 */
function makeLiveResult<A, E>(seed: Option.Option<A>): LiveResultState<A, E> {
  let current = $state.raw<AsyncResult.AsyncResult<A, E>>(
    Option.isSome(seed) ? AsyncResult.success<A, E>(seed.value) : AsyncResult.initial<A, E>(),
  );

  return {
    get current() {
      return current;
    },
    startWaiting() {
      // `startWaiting` runs from inside the hook's `$effect` (via
      // `core.subscribe`), so reading `current` here must be untracked —
      // otherwise the effect depends on its own result state and every
      // emission (which writes `current`) re-triggers the effect, tearing
      // down and re-starting the subscription on every value.
      current = AsyncResult.waiting(untrack(() => current));
    },
    emit(value) {
      current = AsyncResult.success<A, E>(value);
    },
    failCause(cause) {
      current = AsyncResult.failureWithPrevious<A, E>(cause, { previous: Option.some(current) });
    },
  };
}

/**
 * Subscribe to a live `Stream` and track its latest emission, re-subscribing
 * whenever the reactive inputs it reads change.
 *
 * The `stream` thunk is called inside `$effect`, so any reactive state it reads
 * (e.g. a pagination cursor in `$state`) is dependency-tracked; when it changes,
 * the previous subscription is interrupted and a new one starts, keeping the
 * previous value visible as a waiting `Success` (stale-while-revalidate). This
 * is distinct from {@link useStream} (accumulates a static stream) and
 * `reactiveStream` (re-runs an *Effect* on Reactivity-key invalidation).
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useLiveStream } from '@thomasfosterau/effect-svelte';
 *
 *   let cursor = $state(0);
 *
 *   // Re-subscribes whenever `cursor` changes.
 *   const todos = useLiveStream(() => liveTodos(cursor), { initial: seededTodos });
 * </script>
 *
 * <svelte:boundary>
 *   <ul>{#each await todos.promise as todo}<li>{todo.title}</li>{/each}</ul>
 * </svelte:boundary>
 * ```
 */
export function useLiveStream<A, E, R>(
  stream: () => Stream.Stream<A, E, R>,
  options: UseLiveStreamOptions<A, R> = {},
): UseLiveStreamReturn<A, E> {
  const runtime = options.runtime ?? (getRuntime() as RuntimeLike<R>);
  const seed: Option.Option<A> =
    "initial" in options ? Option.some(options.initial as A) : Option.none();

  const state = makeLiveResult<A, E>(seed);
  const core = makeLiveStream(runtime, state);

  $effect(() => {
    // Calling the thunk inside `$effect` tracks the reactive inputs it reads;
    // when they change, the effect re-runs — tearing down the old subscription
    // (interrupt, no Failure) and starting a fresh one.
    const current = stream();
    return core.subscribe(current);
  });

  // A new promise identity is produced only when the underlying result
  // transitions, so awaited template expressions re-run with fresh data instead
  // of on every unrelated re-render.
  const promise = $derived(resultToPromise(state.current));

  return {
    get current() {
      return state.current;
    },
    get promise() {
      return promise;
    },
  };
}
