import { describe, expect, it } from "vite-plus/test";
import { Context, Effect, Layer, ManagedRuntime, Option, Queue, Stream } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { resultToPromise } from "../src/internal/await.js";
import { makeLiveStream, type LiveResultState } from "../src/internal/live-stream.js";

/** Yields to the event loop so forked stream fibers process an emission/exit. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

/**
 * A plain, non-rune {@link LiveResultState} for testing the orchestrator without
 * a Svelte component context. Mirrors the rune holder's transitions and records
 * a history so we can assert (e.g.) that no `fail` ever fires on teardown.
 */
function fakeLive<A, E>(seed?: {
  readonly value: A;
}): LiveResultState<A, E> & {
  readonly history: ReadonlyArray<string>;
} {
  let current: AsyncResult.AsyncResult<A, E> = seed
    ? AsyncResult.success<A, E>(seed.value)
    : AsyncResult.initial<A, E>();
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
    emit(value) {
      history.push("emit");
      current = AsyncResult.success<A, E>(value);
    },
    failCause(cause) {
      history.push("fail");
      current = AsyncResult.failureWithPrevious<A, E>(cause, { previous: Option.some(current) });
    },
  };
}

const valueOf = <A, E>(result: AsyncResult.AsyncResult<A, E>): A | undefined =>
  Option.getOrUndefined(AsyncResult.value(result));

describe("makeLiveStream", () => {
  it("replaces (never appends) on each emission — live queries emit whole result sets", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const state = fakeLive<ReadonlyArray<number>, never>();
    const queue = await runtime.runPromise(Queue.unbounded<ReadonlyArray<number>>());

    const core = makeLiveStream(runtime, state);
    const teardown = core.subscribe(Stream.fromQueue(queue));

    await runtime.runPromise(Queue.offer(queue, [1]));
    await flush();
    expect(valueOf(state.current)).toEqual([1]);

    await runtime.runPromise(Queue.offer(queue, [1, 2, 3]));
    await flush();
    // Replaced wholesale, not [[1], [1,2,3]] appended.
    expect(valueOf(state.current)).toEqual([1, 2, 3]);

    teardown();
    await runtime.dispose();
  });

  it("teardown interruption produces no Failure", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const state = fakeLive<number, never>();
    const queue = await runtime.runPromise(Queue.unbounded<number>());

    const core = makeLiveStream(runtime, state);
    const teardown = core.subscribe(Stream.fromQueue(queue));

    await runtime.runPromise(Queue.offer(queue, 1));
    await flush();
    expect(valueOf(state.current)).toBe(1);

    // Tearing down interrupts the fiber — this must not settle a Failure.
    teardown();
    await flush();

    expect(AsyncResult.isFailure(state.current)).toBe(false);
    expect(state.history).not.toContain("fail");
    // The last good value is still visible.
    expect(valueOf(state.current)).toBe(1);

    await runtime.dispose();
  });

  it("settles a Failure on a genuine stream failure (Cause.hasFails)", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const state = fakeLive<number, string>();

    const core = makeLiveStream(runtime, state);
    core.subscribe(Stream.fail("boom"));
    await flush();

    expect(AsyncResult.isFailure(state.current)).toBe(true);
    await expect(resultToPromise(state.current)).rejects.toBe("boom");

    await runtime.dispose();
  });

  it("settles a Failure on a defect (Cause.hasDies)", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const state = fakeLive<number, never>();

    const core = makeLiveStream(runtime, state);
    core.subscribe(Stream.fromEffect(Effect.die(new Error("kaboom"))));
    await flush();

    expect(AsyncResult.isFailure(state.current)).toBe(true);

    await runtime.dispose();
  });

  it("re-subscription keeps the previous value visible as a waiting Success", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const state = fakeLive<ReadonlyArray<string>, never>();
    const first = await runtime.runPromise(Queue.unbounded<ReadonlyArray<string>>());
    const second = await runtime.runPromise(Queue.unbounded<ReadonlyArray<string>>());

    const core = makeLiveStream(runtime, state);
    const teardown = core.subscribe(Stream.fromQueue(first));

    await runtime.runPromise(Queue.offer(first, ["a"]));
    await flush();
    expect(valueOf(state.current)).toEqual(["a"]);
    expect(AsyncResult.isWaiting(state.current)).toBe(false);

    // Simulate the hook's $effect re-running on a reactive-input change:
    // teardown the old subscription, then subscribe the new one.
    teardown();
    core.subscribe(Stream.fromQueue(second));

    // Before the new subscription emits, the previous value is still shown —
    // as a waiting Success (stale-while-revalidate), not Initial.
    expect(AsyncResult.isSuccess(state.current)).toBe(true);
    expect(AsyncResult.isWaiting(state.current)).toBe(true);
    expect(valueOf(state.current)).toEqual(["a"]);
    // The stale value keeps `promise` resolved (no re-pending on re-subscribe).
    await expect(resultToPromise(state.current)).resolves.toEqual(["a"]);

    await runtime.runPromise(Queue.offer(second, ["b"]));
    await flush();
    expect(valueOf(state.current)).toEqual(["b"]);
    expect(AsyncResult.isWaiting(state.current)).toBe(false);

    await runtime.dispose();
  });

  it("drops a superseded subscription's late emission (epoch guard)", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const state = fakeLive<number, never>();
    const stale = await runtime.runPromise(Queue.unbounded<number>());
    const fresh = await runtime.runPromise(Queue.unbounded<number>());

    const core = makeLiveStream(runtime, state);
    const teardown = core.subscribe(Stream.fromQueue(stale));
    teardown();
    core.subscribe(Stream.fromQueue(fresh));

    await runtime.runPromise(Queue.offer(fresh, 2));
    await flush();
    expect(valueOf(state.current)).toBe(2);

    // A late offer on the superseded queue must never clobber the fresh value.
    await runtime.runPromise(Queue.offer(stale, 99));
    await flush();
    expect(valueOf(state.current)).toBe(2);

    await runtime.dispose();
  });

  it("runs against an explicit service-typed runtime", async () => {
    class Multiplier extends Context.Service<Multiplier, { readonly factor: number }>()(
      "test/Multiplier",
    ) {}

    const runtime = ManagedRuntime.make(Layer.succeed(Multiplier, { factor: 10 }));
    const state = fakeLive<number, never>();

    const core = makeLiveStream(runtime, state);
    // The stream requires the `Multiplier` service; it only type-checks (and
    // runs) because the runtime provides it.
    core.subscribe(
      Stream.fromEffect(
        Effect.gen(function* () {
          const m = yield* Multiplier;
          return m.factor * 5;
        }),
      ),
    );
    await flush();

    expect(valueOf(state.current)).toBe(50);

    await runtime.dispose();
  });
});

describe("useLiveStream promise mapping (unit)", () => {
  it("initial seed yields a synchronous non-waiting Success and a resolved promise", async () => {
    const seeded = AsyncResult.success<ReadonlyArray<number>, never>([1, 2]);
    expect(AsyncResult.isSuccess(seeded)).toBe(true);
    expect(AsyncResult.isWaiting(seeded)).toBe(false);
    await expect(resultToPromise(seeded)).resolves.toEqual([1, 2]);
  });

  it("stays pending until the first emission, then resolves per emission", async () => {
    const pending = AsyncResult.initial<number, never>(true);
    // No value yet → pending.
    const marker = Symbol("pending");
    const race = await Promise.race([
      resultToPromise(pending).then(() => "settled" as const),
      new Promise<typeof marker>((r) => setTimeout(() => r(marker), 10)),
    ]);
    expect(race).toBe(marker);

    // First emission → resolved; a second emission produces a new resolved promise.
    await expect(resultToPromise(AsyncResult.success<number, never>(1))).resolves.toBe(1);
    await expect(resultToPromise(AsyncResult.success<number, never>(2))).resolves.toBe(2);
  });
});
