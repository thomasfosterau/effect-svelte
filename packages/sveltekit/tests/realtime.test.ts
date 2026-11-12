import { it } from "@effect/vitest";
import { assert, describe, expect } from "vite-plus/test";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as Realtime from "../src/realtime.js";
import { ForeignError } from "./fixtures/foreign-error.js";

/**
 * Wait until the forked stream fiber has opened a fake socket. A single event-
 * loop tick is not enough — `Stream.callback`'s setup effect runs across several
 * microtasks — so poll until the socket exists before driving it. Real time:
 * run it in `it.live`.
 */
const awaitSocket = (attempts = 200): Effect.Effect<FakeSocket> =>
  Effect.suspend(() => {
    const socket = FakeSocket.instances[0];
    if (socket !== undefined) return Effect.succeed(socket);
    if (attempts === 0) return Effect.die(new ForeignError("socket was never opened"));
    return Effect.andThen(Effect.sleep("5 millis"), awaitSocket(attempts - 1));
  });

/**
 * The fields of the DOM `MessageEvent` / `CloseEvent` the realtime streams
 * read, which a test's fake event carries.
 */
interface FakeEvent {
  readonly type?: string;
  readonly data?: string;
  readonly lastEventId?: string;
  readonly wasClean?: boolean;
  readonly code?: number;
  readonly reason?: string;
}

/** A minimal, drivable fake of the DOM `WebSocket` / `EventSource` surface. */
class FakeSocket {
  static instances: Array<FakeSocket> = [];
  readyState = 1;
  binaryType = "blob";
  private listeners: Record<string, Array<(e: FakeEvent) => void>> = {};

  constructor(
    readonly url: string,
    readonly protocols?: string | ReadonlyArray<string>,
  ) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, fn: (e: FakeEvent) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }

  closeCalls = 0;

  close(): void {
    this.closeCalls++;
    this.readyState = 3;
  }

  emit(type: string, event: FakeEvent): void {
    Arr.forEach(this.listeners[type] ?? [], (fn) => fn(event));
  }
}

// SAFETY: `fromWebSocket` touches only `binaryType`, `addEventListener`,
// `readyState` and `close` on the socket, all of which `FakeSocket` implements,
// and reads only the `FakeEvent` fields of the events it dispatches.
const FakeWebSocket: Realtime.WebSocketConstructor = FakeSocket as never;

// SAFETY: `fromEventSource` touches only `addEventListener`, `readyState` and
// `close` on the source, all of which `FakeSocket` implements, and reads only
// the `FakeEvent` fields of the events it dispatches.
const FakeEventSource: Realtime.EventSourceConstructor = FakeSocket as never;

/** A constructor that throws as `new WebSocket(url)` / `new EventSource(url)` do for an invalid URL. */
const invalidUrl = new SyntaxError("The URL 'x' is invalid.");
class ThrowingSocket {
  static attempts = 0;
  constructor() {
    ThrowingSocket.attempts++;
    throw invalidUrl;
  }
}

// SAFETY: the constructor always throws, so no instance is ever used as a socket.
const ThrowingWebSocket: Realtime.WebSocketConstructor = ThrowingSocket as never;

// SAFETY: the constructor always throws, so no instance is ever used as a source.
const ThrowingEventSource: Realtime.EventSourceConstructor = ThrowingSocket as never;

/**
 * Run a stream that is expected to fail and return its typed error, asserting
 * the failure is that error alone: no defect (such as a release run on a
 * resource that was never acquired) and no interruption. The timeout only
 * guards against a hang, so it fails the test rather than passing it.
 */
const runToError = <E>(stream: Stream.Stream<unknown, E>): Effect.Effect<E> =>
  Effect.gen(function* () {
    const exit = yield* stream.pipe(Stream.runCollect, Effect.timeout("2 seconds"), Effect.exit);
    assert(Exit.isFailure(exit), "expected the stream to fail");
    const [reason, ...rest] = exit.cause.reasons;
    expect(rest).toEqual([]);
    assert(
      reason !== undefined && Cause.isFailReason(reason),
      `expected a typed failure, got ${Cause.pretty(exit.cause)}`,
    );
    const error = reason.error;
    assert(!Cause.isTimeoutError(error), "the stream timed out");
    return error;
  });

describe("Realtime.fromWebSocket", () => {
  it.live("fails with WebSocketError carrying the cause when the constructor throws", () =>
    Effect.gen(function* () {
      ThrowingSocket.attempts = 0;
      const error = yield* runToError(
        Realtime.fromWebSocket("x", { implementation: ThrowingWebSocket }),
      );
      expect(error).toBeInstanceOf(Realtime.WebSocketError);
      expect(error._tag).toBe("WebSocketError");
      expect(error.url).toBe("x");
      expect(error.cause).toBe(invalidUrl);
      expect(ThrowingSocket.attempts).toBe(1);
    }),
  );

  it.live("emits each message's data as a stream element", () =>
    Effect.gen(function* () {
      FakeSocket.instances = [];
      const fiber = yield* Effect.forkChild(
        Realtime.fromWebSocket("ws://x", { implementation: FakeWebSocket }).pipe(
          Stream.take(2),
          Stream.runCollect,
        ),
      );
      const socket = yield* awaitSocket();
      socket.emit("message", { data: "a" });
      socket.emit("message", { data: "b" });

      const result = yield* Fiber.join(fiber);
      expect(result).toEqual(["a", "b"]);
    }),
  );

  it.live("ends the stream on a clean close", () =>
    Effect.gen(function* () {
      FakeSocket.instances = [];
      const fiber = yield* Effect.forkChild(
        Realtime.fromWebSocket("ws://x", { implementation: FakeWebSocket }).pipe(Stream.runCollect),
      );
      const socket = yield* awaitSocket();
      socket.emit("message", { data: "only" });
      socket.emit("close", { wasClean: true, code: 1000, reason: "" });

      const result = yield* Fiber.join(fiber);
      expect(result).toEqual(["only"]);
    }),
  );

  it.live("fails with WebSocketError on an unclean close", () =>
    Effect.gen(function* () {
      FakeSocket.instances = [];
      const fiber = yield* Effect.forkChild(
        Realtime.fromWebSocket("ws://x", { implementation: FakeWebSocket }).pipe(Stream.runCollect),
      );
      const socket = yield* awaitSocket();
      socket.emit("close", { wasClean: false, code: 1006, reason: "boom" });

      const exit = yield* Effect.exit(Fiber.join(fiber));
      expect(exit._tag).toBe("Failure");
    }),
  );

  it.live("closes the socket when the stream fails", () =>
    Effect.gen(function* () {
      FakeSocket.instances = [];
      const fiber = yield* Effect.forkChild(
        Realtime.fromWebSocket("ws://x", { implementation: FakeWebSocket }).pipe(Stream.runCollect),
      );
      const socket = yield* awaitSocket();
      expect(socket.closeCalls).toBe(0);
      // An `error` event fails the stream while the socket is still open.
      socket.emit("error", {});

      const exit = yield* Effect.exit(Fiber.join(fiber));
      expect(exit._tag).toBe("Failure");
      expect(socket.closeCalls).toBe(1);
    }),
  );

  it.live("closes the socket when the stream ends", () =>
    Effect.gen(function* () {
      FakeSocket.instances = [];
      const fiber = yield* Effect.forkChild(
        Realtime.fromWebSocket("ws://x", { implementation: FakeWebSocket }).pipe(
          Stream.take(1),
          Stream.runCollect,
        ),
      );
      const socket = yield* awaitSocket();
      expect(socket.closeCalls).toBe(0);
      socket.emit("message", { data: "a" });

      yield* Fiber.join(fiber);
      expect(socket.closeCalls).toBe(1);
    }),
  );

  it.live("closes the socket when the stream is interrupted", () =>
    Effect.gen(function* () {
      FakeSocket.instances = [];
      const fiber = yield* Effect.forkChild(
        Realtime.fromWebSocket("ws://x", { implementation: FakeWebSocket }).pipe(Stream.runCollect),
      );
      const socket = yield* awaitSocket();
      expect(socket.closeCalls).toBe(0);

      // `Fiber.interrupt` waits for the stream's scope to close.
      yield* Fiber.interrupt(fiber);
      expect(socket.closeCalls).toBe(1);
    }),
  );

  it.live("does not close a socket that has already closed", () =>
    Effect.gen(function* () {
      FakeSocket.instances = [];
      const fiber = yield* Effect.forkChild(
        Realtime.fromWebSocket("ws://x", { implementation: FakeWebSocket }).pipe(Stream.runCollect),
      );
      const socket = yield* awaitSocket();
      socket.readyState = 3;
      socket.emit("close", { wasClean: true, code: 1000, reason: "" });

      yield* Fiber.join(fiber);
      expect(socket.closeCalls).toBe(0);
    }),
  );
});

describe("Realtime.fromEventSource", () => {
  it.live("fails with EventSourceError carrying the cause when the constructor throws", () =>
    Effect.gen(function* () {
      ThrowingSocket.attempts = 0;
      const error = yield* runToError(
        Realtime.fromEventSource("x", {
          withCredentials: true,
          implementation: ThrowingEventSource,
        }),
      );
      expect(error).toBeInstanceOf(Realtime.EventSourceError);
      expect(error._tag).toBe("EventSourceError");
      expect(error.url).toBe("x");
      expect(error.cause).toBe(invalidUrl);
      expect(ThrowingSocket.attempts).toBe(1);
    }),
  );

  it.live("emits decoded SSE messages", () =>
    Effect.gen(function* () {
      FakeSocket.instances = [];
      const fiber = yield* Effect.forkChild(
        Realtime.fromEventSource("/events", { implementation: FakeEventSource }).pipe(
          Stream.take(1),
          Stream.runCollect,
        ),
      );
      const socket = yield* awaitSocket();
      socket.emit("message", { type: "message", data: "hi", lastEventId: "7" });

      const result = yield* Fiber.join(fiber);
      expect(result).toEqual([{ event: "message", data: "hi", lastEventId: "7" }]);
    }),
  );

  it.live("listens for named events too", () =>
    Effect.gen(function* () {
      FakeSocket.instances = [];
      const fiber = yield* Effect.forkChild(
        Realtime.fromEventSource("/events", {
          events: ["tick"],
          implementation: FakeEventSource,
        }).pipe(Stream.take(1), Stream.runCollect),
      );
      const socket = yield* awaitSocket();
      socket.emit("tick", { type: "tick", data: "1", lastEventId: "" });

      const result = yield* Fiber.join(fiber);
      expect(result).toEqual([{ event: "tick", data: "1", lastEventId: "" }]);
    }),
  );

  it.live("closes the source when the stream ends", () =>
    Effect.gen(function* () {
      FakeSocket.instances = [];
      const fiber = yield* Effect.forkChild(
        Realtime.fromEventSource("/events", { implementation: FakeEventSource }).pipe(
          Stream.take(1),
          Stream.runCollect,
        ),
      );
      const source = yield* awaitSocket();
      expect(source.closeCalls).toBe(0);
      source.emit("message", { type: "message", data: "hi", lastEventId: "" });

      yield* Fiber.join(fiber);
      expect(source.closeCalls).toBe(1);
    }),
  );

  it.live("closes the source when the stream is interrupted", () =>
    Effect.gen(function* () {
      FakeSocket.instances = [];
      const fiber = yield* Effect.forkChild(
        Realtime.fromEventSource("/events", { implementation: FakeEventSource }).pipe(
          Stream.runCollect,
        ),
      );
      const source = yield* awaitSocket();
      expect(source.closeCalls).toBe(0);

      // `Fiber.interrupt` waits for the stream's scope to close.
      yield* Fiber.interrupt(fiber);
      expect(source.closeCalls).toBe(1);
    }),
  );
});
