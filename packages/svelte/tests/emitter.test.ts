import { describe, expect, it } from "vite-plus/test";
import { Effect, Fiber, Option, PubSub, Queue, Stream } from "effect";
import { SignalEmitter } from "../src/emitter.js";

/**
 * Runs `emitter.stream` in a child fiber that forwards each element into a
 * queue, and returns once the stream is connected to the emitter.
 *
 * The emitter has no "connected" signal, so this emits negative probe values,
 * yielding between each, until one arrives. A bounded loop of `yieldNow`s keeps
 * it deterministic: no wall-clock sleep. `next` skips any probes still in
 * flight (or received by another run) and returns the next real (non-negative)
 * value.
 */
const connect = (emitter: SignalEmitter<number>) =>
  Effect.gen(function* () {
    const received = yield* Queue.unbounded<number>();
    const fiber = yield* Effect.forkChild(
      Stream.runForEach(emitter.stream, (value) => Queue.offer(received, value)),
    );

    let connected = false;
    for (let probe = 1; probe <= 1_000 && !connected; probe++) {
      emitter.emit(-probe);
      yield* Effect.yieldNow;
      connected = Option.isSome(yield* Queue.poll(received));
    }
    if (!connected) return yield* Effect.die(new Error("the stream never connected"));

    const take: Effect.Effect<number> = Queue.take(received).pipe(
      Effect.flatMap((value) => (value < 0 ? take : Effect.succeed(value))),
    );
    // Bounded only so a regression fails fast instead of hanging the suite;
    // the passing path never waits on the clock.
    const next = take.pipe(Effect.timeout("2 seconds"));
    return { fiber, next };
  });

/** Runs a fresh run of `emitter.stream` until it has received `n` values. */
const collect = (emitter: SignalEmitter<number>, n: number) =>
  Stream.take(emitter.stream, n).pipe(
    Stream.runCollect,
    // Bounded only so a regression fails fast instead of hanging the suite.
    Effect.timeout("2 seconds"),
  );

describe("SignalEmitter", () => {
  it("delivers values emitted after the stream has started", async () => {
    const emitter = new SignalEmitter<number>();

    const values = await Effect.runPromise(
      Effect.gen(function* () {
        const { fiber, next } = yield* connect(emitter);
        emitter.emit(1);
        const first = yield* next;
        emitter.emit(2);
        emitter.emit(3);
        const second = yield* next;
        const third = yield* next;
        yield* Fiber.interrupt(fiber);
        return [first, second, third];
      }),
    );

    expect(values).toEqual([1, 2, 3]);
  });

  it("delivers values emitted before any run connects to the first run, in order", async () => {
    const emitter = new SignalEmitter<number>();
    emitter.emit(1);
    emitter.emit(2);
    emitter.emit(3);

    const values = await Effect.runPromise(collect(emitter, 3));

    expect(values).toEqual([1, 2, 3]);
  });

  it("keeps only the most recent `bufferSize` values while no run is connected", async () => {
    const emitter = new SignalEmitter<number>({ bufferSize: 2 });
    for (const value of [1, 2, 3, 4]) emitter.emit(value);

    const values = await Effect.runPromise(collect(emitter, 2));

    expect(values).toEqual([3, 4]);
  });

  it("drops values emitted while no run is connected when `bufferSize` is 0", async () => {
    const emitter = new SignalEmitter<number>({ bufferSize: 0 });
    emitter.emit(1);

    const value = await Effect.runPromise(
      Effect.gen(function* () {
        const { fiber, next } = yield* connect(emitter);
        emitter.emit(2);
        const received = yield* next;
        yield* Fiber.interrupt(fiber);
        return received;
      }),
    );

    expect(value).toBe(2);
  });

  it("delivers every value to every concurrently running run", async () => {
    const emitter = new SignalEmitter<number>();

    const values = await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* connect(emitter);
        const second = yield* connect(emitter);
        for (const value of [1, 2, 3]) emitter.emit(value);
        const firstValues = [yield* first.next, yield* first.next, yield* first.next];
        const secondValues = [yield* second.next, yield* second.next, yield* second.next];
        yield* Fiber.interrupt(first.fiber);
        yield* Fiber.interrupt(second.fiber);
        return { firstValues, secondValues };
      }),
    );

    expect(values).toEqual({ firstValues: [1, 2, 3], secondValues: [1, 2, 3] });
  });

  it("releases a run's subscription when it is interrupted, and buffers for the next run", async () => {
    const emitter = new SignalEmitter<number>();
    // White-box: an unbounded PubSub retains a published message only while
    // some subscription has yet to take it, so a leaked subscription shows up
    // as a non-zero size.
    const pubsub: PubSub.PubSub<number> = emitter["_pubsub"];

    const value = await Effect.runPromise(
      Effect.gen(function* () {
        const { fiber } = yield* connect(emitter);
        yield* Fiber.interrupt(fiber);

        PubSub.publishUnsafe(pubsub, 99);
        expect(PubSub.sizeUnsafe(pubsub)).toBe(0);

        // With no run connected, the next emit is buffered for the next run
        // rather than published to nobody.
        emitter.emit(5);
        const [received] = yield* collect(emitter, 1);
        return received;
      }),
    );

    expect(value).toBe(5);
  });

  it("keeps a newer run connected when an older run is interrupted", async () => {
    const emitter = new SignalEmitter<number>();

    const value = await Effect.runPromise(
      Effect.gen(function* () {
        const older = yield* connect(emitter);
        const newer = yield* connect(emitter);
        // The older run's finalizer must not disconnect the newer run.
        yield* Fiber.interrupt(older.fiber);
        emitter.emit(7);
        const received = yield* newer.next;
        yield* Fiber.interrupt(newer.fiber);
        return received;
      }),
    );

    expect(value).toBe(7);
  });
});
