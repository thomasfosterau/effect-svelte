import { describe, expect, it } from "vite-plus/test";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { SignalEmitter } from "../src/emitter.js";

/**
 * Runs `emitter.stream` in a child fiber that forwards each element into a
 * queue, and returns once that run is connected to the emitter. `next` takes
 * the run's next value, starting with any it took from the buffer.
 *
 * White-box: this waits for the emitter's count of connected runs to grow
 * rather than emitting probe values, because a probe emitted before the run
 * connects would itself be buffered and, with a small `bufferSize`, displace
 * the values a test buffered (and a received probe would hide whether those
 * arrived). A bounded loop of `yieldNow`s keeps it deterministic: no
 * wall-clock sleep.
 */
const connect = (emitter: SignalEmitter<number>) =>
  Effect.gen(function* () {
    const connectedRuns = (): number => emitter["_connected"];
    const before = connectedRuns();
    const received = yield* Queue.unbounded<number>();
    const fiber = yield* Effect.forkChild(
      Stream.runForEach(emitter.stream, (value) => Queue.offer(received, value)),
    );

    const awaitConnection = (remaining: number): Effect.Effect<void> =>
      Effect.suspend(() =>
        remaining === 0 || connectedRuns() !== before
          ? Effect.void
          : Effect.andThen(Effect.yieldNow, awaitConnection(remaining - 1)),
      );
    yield* awaitConnection(1_000);
    if (connectedRuns() === before) {
      return yield* Effect.die(new Error("the stream never connected"));
    }

    // Bounded only so a regression fails fast instead of hanging the suite;
    // the passing path never waits on the clock.
    const next = Queue.take(received).pipe(Effect.timeout("2 seconds"));
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

  it("keeps only the latest value emitted while no run is connected by default", async () => {
    const emitter = new SignalEmitter<number>();
    emitter.emit(1);
    emitter.emit(2);
    emitter.emit(3);

    const value = await Effect.runPromise(
      Effect.gen(function* () {
        const { fiber, next } = yield* connect(emitter);
        emitter.emit(4);
        const received = [yield* next, yield* next];
        yield* Fiber.interrupt(fiber);
        return received;
      }),
    );

    expect(value).toEqual([3, 4]);
  });

  it("delivers values emitted before any run connects to the next run, in order", async () => {
    const emitter = new SignalEmitter<number>({ bufferSize: 3 });
    emitter.emit(1);
    emitter.emit(2);
    emitter.emit(3);

    const values = await Effect.runPromise(collect(emitter, 3));

    expect(values).toEqual([1, 2, 3]);
  });

  it("keeps only the most recent `bufferSize` values while no run is connected", async () => {
    const emitter = new SignalEmitter<number>({ bufferSize: 2 });
    Arr.forEach([1, 2, 3, 4], (value) => emitter.emit(value));

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

  it("rounds a fractional `bufferSize` down and treats a negative one as 0", async () => {
    const fractional = new SignalEmitter<number>({ bufferSize: 2.7 });
    Arr.forEach([1, 2, 3], (value) => fractional.emit(value));
    const negative = new SignalEmitter<number>({ bufferSize: -1 });
    negative.emit(1);

    const values = await Effect.runPromise(
      Effect.gen(function* () {
        const fromFractional = yield* collect(fractional, 2);
        const { fiber, next } = yield* connect(negative);
        negative.emit(2);
        const fromNegative = yield* next;
        yield* Fiber.interrupt(fiber);
        return { fromFractional, fromNegative };
      }),
    );

    expect(values).toEqual({ fromFractional: [2, 3], fromNegative: 2 });
  });

  it("throws a RangeError for a non-finite `bufferSize`", () => {
    expect(() => new SignalEmitter<number>({ bufferSize: Number.NaN })).toThrow(RangeError);
    expect(() => new SignalEmitter<number>({ bufferSize: Infinity })).toThrow(RangeError);
  });

  it("delivers every value to every concurrently running run", async () => {
    const emitter = new SignalEmitter<number>();

    const values = await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* connect(emitter);
        const second = yield* connect(emitter);
        Arr.forEach([1, 2, 3], (value) => emitter.emit(value));
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
