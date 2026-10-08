import { describe, expect, it } from "vite-plus/test";
import { Effect, Fiber, Option, Queue, Stream } from "effect";
import { SignalEmitter } from "../src/emitter.js";

/**
 * Runs `emitter.stream` in a child fiber that forwards each element into a
 * queue, and returns once the stream is connected to the emitter.
 *
 * The emitter has no "connected" signal, so this emits negative probe values,
 * yielding between each, until one arrives. A bounded loop of `yieldNow`s keeps
 * it deterministic: no wall-clock sleep. `next` skips any probes still in
 * flight and returns the next real (non-negative) value.
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

  it("disconnects emit() from the stream when the stream is interrupted", async () => {
    const emitter = new SignalEmitter<number>();
    // White-box: the connection is only observable through the private
    // `_emit` handler (emits into a closed stream are silently dropped either
    // way), so check the stream's finalizer swaps it back out.
    const handler = () => emitter["_emit"];
    const idle = handler();

    const whileConnected = await Effect.runPromise(
      Effect.gen(function* () {
        const { fiber } = yield* connect(emitter);
        const connected = handler();
        yield* Fiber.interrupt(fiber);
        return connected;
      }),
    );

    expect(whileConnected).not.toBe(idle);
    expect(handler()).not.toBe(whileConnected);
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
