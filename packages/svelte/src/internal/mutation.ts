import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import { Reactivity } from "effect/reactivity";
import { holds, interruptFiber, runFork, type RuntimeLike } from "./run.js";
import type { ResultState } from "./result.svelte.js";

/**
 * Lifecycle callbacks for a mutation, following TanStack Query conventions.
 *
 * `onMutate` runs synchronously before the effect starts and its return value
 * is threaded through `onSuccess` / `onError` / `onSettled` as `context` — the
 * idiomatic place to apply an optimistic update and capture a snapshot for
 * rollback. `context` is an `Option`: `Some` with what `onMutate` returned,
 * `None` when no `onMutate` was given.
 */
export interface MutationCallbacks<A, E, I, C> {
  /**
   * Runs before the mutation effect. Apply an optimistic update here and return
   * any value (e.g. a snapshot) to receive it back as `context` in the other
   * callbacks — use it to roll back in `onError`.
   */
  readonly onMutate?: (input: I) => C;
  /**
   * Runs after the mutation succeeds, before invalidation. `context` is `Some`
   * with `onMutate`'s return value, `None` when there is no `onMutate`.
   */
  readonly onSuccess?: (value: A, input: I, context: Option.Option<C>) => void;
  /**
   * Runs after the mutation fails with a typed error. Pure defects (dies)
   * still settle `current` as a failure but do not invoke this callback, since
   * there is no `E` value to hand back — inspect `current` for those.
   * `context` is `Some` with `onMutate`'s return value, `None` when there is
   * no `onMutate`.
   */
  readonly onError?: (error: E, input: I, context: Option.Option<C>) => void;
  /**
   * Runs after `onSuccess` / `onError`, regardless of outcome. `context` is
   * `Some` with `onMutate`'s return value, `None` when there is no `onMutate`.
   */
  readonly onSettled?: (input: I, context: Option.Option<C>) => void;
  /**
   * Reactivity keys to invalidate after a successful mutation (a static array
   * or a function of the input). Requires the runtime to include
   * `Reactivity.layer` from `effect/reactivity`.
   */
  readonly invalidates?: ReadonlyArray<unknown> | ((input: I) => ReadonlyArray<unknown>);
}

/** The imperative surface of a mutation, independent of any rune state. */
export interface MutationCore<I> {
  /** Run the mutation for `input`, interrupting any in-flight run. */
  readonly mutate: (input: I) => void;
  /** Interrupt the in-flight run and reset the result to `Initial`. */
  readonly reset: () => void;
  /** Interrupt the in-flight run without resetting the result. */
  readonly interrupt: () => void;
}

/**
 * The orchestration half of {@link useMutation}, factored out of the rune
 * wrapper so it can be unit-tested with a plain (non-rune) {@link ResultState}
 * and a real runtime.
 *
 * Drives `state` through the stale-while-revalidate transitions and dispatches
 * the {@link MutationCallbacks} from the settled `Exit`. Interrupted runs (a
 * newer `mutate` replacing an older one, or teardown) are ignored so a
 * superseded run never clobbers the latest result.
 */
export function makeMutation<A, E, I, C, R>(
  runtime: RuntimeLike<R>,
  state: ResultState<A, E>,
  fn: (input: I) => Effect.Effect<A, E, R>,
  callbacks: MutationCallbacks<A, E, I, C> = {},
): MutationCore<I> {
  let currentFiber: Option.Option<Fiber.Fiber<A, E>> = Option.none();

  const mutate = (input: I): void => {
    if (Option.isSome(currentFiber)) interruptFiber(currentFiber.value);

    const context = Option.map(Option.fromUndefinedOr(callbacks.onMutate), (onMutate) =>
      onMutate(input),
    );
    state.startWaiting();

    const running = runFork(runtime)(fn(input));
    currentFiber = Option.some(running);

    runFork(runtime)(
      Effect.gen(function* () {
        const exit = yield* Fiber.await(running);
        // A newer mutate (or teardown) has superseded this run.
        if (!holds(currentFiber, running)) return;
        currentFiber = Option.none();

        if (Exit.isSuccess(exit)) {
          state.settle(exit);
          callbacks.onSuccess?.(exit.value, input, context);
          const keys = P.isFunction(callbacks.invalidates)
            ? callbacks.invalidates(input)
            : callbacks.invalidates;
          if (keys !== undefined) {
            // `invalidates` requires the runtime to provide `Reactivity` (the
            // documented contract of the option), which `R` does not record: look
            // the service up in the running fiber's context, where a runtime
            // without it dies with Effect's "Service not found" defect, as
            // `Reactivity.invalidate` would.
            runFork(runtime)(
              Effect.contextWith((services: Context.Context<never>) =>
                Context.getUnsafe(services, Reactivity.Reactivity).invalidate(keys),
              ),
            );
          }
          callbacks.onSettled?.(input, context);
          return;
        }

        // Interruption is normal teardown; keep the prior state.
        if (Cause.hasInterrupts(exit.cause)) return;

        state.settle(exit);
        const error = Cause.findErrorOption(exit.cause);
        if (Option.isSome(error)) callbacks.onError?.(error.value, input, context);
        callbacks.onSettled?.(input, context);
      }),
    );
  };

  const interrupt = (): void => {
    if (Option.isSome(currentFiber)) {
      interruptFiber(currentFiber.value);
      currentFiber = Option.none();
    }
  };

  const reset = (): void => {
    interrupt();
    state.reset();
  };

  return { mutate, reset, interrupt };
}
