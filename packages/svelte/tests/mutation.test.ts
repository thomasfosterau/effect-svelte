import { describe, expect, it } from "vite-plus/test";
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Queue } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { Reactivity } from "effect/unstable/reactivity";
import { makeMutation } from "../src/internal/mutation.js";
import type { ResultState } from "../src/internal/result.svelte.js";

/** Yields to the event loop so forked fibers settle. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A plain, non-rune {@link ResultState} for testing the mutation orchestrator
 * without a Svelte component context. Mirrors `makeResult`'s transitions.
 */
function fakeResult<A, E>(): ResultState<A, E> & { history: Array<string> } {
  let current: AsyncResult.AsyncResult<A, E> = AsyncResult.initial<A, E>();
  const history: Array<string> = [];
  return {
    history,
    get current() {
      return current;
    },
    startWaiting() {
      history.push("waiting");
      current = AsyncResult.waiting(current);
    },
    reset() {
      history.push("reset");
      current = AsyncResult.initial<A, E>();
    },
    settle(exit) {
      if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)) return;
      history.push(Exit.isSuccess(exit) ? "settle:success" : "settle:failure");
      current = AsyncResult.fromExitWithPrevious(exit, Option.some(current));
    },
    succeed(value) {
      history.push("succeed");
      current = AsyncResult.success<A, E>(value);
    },
    failCause(cause) {
      if (Cause.hasInterrupts(cause)) return;
      history.push("failCause");
      current = AsyncResult.failureWithPrevious<A, E>(cause, { previous: Option.some(current) });
    },
  };
}

describe("makeMutation", () => {
  it("runs the effect and settles a success", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const state = fakeResult<number, never>();

    const core = makeMutation(runtime, state, (n: number) => Effect.succeed(n * 2));
    core.mutate(21);
    await flush();

    expect(AsyncResult.isSuccess(state.current)).toBe(true);
    expect(Option.getOrUndefined(AsyncResult.value(state.current))).toBe(42);

    await runtime.dispose();
  });

  it("fires onMutate → onSuccess → onSettled with the threaded context", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const state = fakeResult<string, never>();

    const calls: Array<string> = [];
    const core = makeMutation(runtime, state, (name: string) => Effect.succeed(`hi ${name}`), {
      onMutate: (input) => {
        calls.push(`onMutate:${input}`);
        return { snapshot: input };
      },
      onSuccess: (value, input, context) => {
        calls.push(`onSuccess:${value}:${input}:${context?.snapshot}`);
      },
      onSettled: (input, context) => {
        calls.push(`onSettled:${input}:${context?.snapshot}`);
      },
    });

    core.mutate("ada");
    await flush();

    expect(calls).toEqual(["onMutate:ada", "onSuccess:hi ada:ada:ada", "onSettled:ada:ada"]);

    await runtime.dispose();
  });

  it("fires onError with the typed error on failure", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const state = fakeResult<never, string>();

    const errors: Array<string> = [];
    const core = makeMutation(runtime, state, () => Effect.fail("boom"), {
      onError: (error) => errors.push(error),
      onSuccess: () => errors.push("SHOULD-NOT-RUN"),
    });

    core.mutate(undefined);
    await flush();

    expect(errors).toEqual(["boom"]);
    expect(AsyncResult.isFailure(state.current)).toBe(true);

    await runtime.dispose();
  });

  it("invalidates reactivity keys after success", async () => {
    const runtime = ManagedRuntime.make(Reactivity.layer);
    const state = fakeResult<number, never>();

    // A reactive query over ['count'] emits a fresh value on every invalidation.
    let runs = 0;
    const observed: Array<number> = [];
    const queryFiber = runtime.runFork(
      Effect.scoped(
        Effect.gen(function* () {
          const queue = yield* Reactivity.query(
            Effect.sync(() => ++runs),
            ["count"],
          );
          // Initial result on subscribe, then the result after invalidation.
          observed.push(yield* Queue.take(queue));
          observed.push(yield* Queue.take(queue));
        }),
      ),
    );
    await flush();

    const core = makeMutation(runtime, state, (n: number) => Effect.succeed(n), {
      invalidates: ["count"],
    });
    core.mutate(1);
    await flush();

    queryFiber.interruptUnsafe();
    // First run on subscribe, second after the mutation invalidated the key.
    expect(observed).toEqual([1, 2]);

    await runtime.dispose();
  });

  it("reset interrupts and returns to Initial", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const state = fakeResult<number, never>();

    const core = makeMutation(runtime, state, (n: number) => Effect.succeed(n));
    core.mutate(1);
    await flush();
    core.reset();

    expect(AsyncResult.isInitial(state.current)).toBe(true);
    expect(state.history.at(-1)).toBe("reset");

    await runtime.dispose();
  });

  it("a superseding mutate discards the earlier run's result", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const state = fakeResult<string, never>();

    const core = makeMutation(runtime, state, (input: { value: string; delay: number }) =>
      Effect.delay(Effect.succeed(input.value), `${input.delay} millis`),
    );

    core.mutate({ value: "slow", delay: 40 });
    core.mutate({ value: "fast", delay: 5 });
    await new Promise((resolve) => setTimeout(resolve, 80));

    // The slow (superseded) run must not clobber the fast result.
    expect(Option.getOrUndefined(AsyncResult.value(state.current))).toBe("fast");

    await runtime.dispose();
  });
});
