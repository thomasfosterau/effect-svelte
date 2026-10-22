import { describe, expect, it } from "vite-plus/test";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as Realtime from "../src/realtime.js";

/**
 * Wait until the forked stream fiber has opened a fake socket. A single event-
 * loop tick is not enough — `Stream.callback`'s setup effect runs across several
 * microtasks — so poll until the socket exists before driving it.
 */
const awaitSocket = async (): Promise<FakeSocket> => {
  for (let i = 0; i < 200 && FakeSocket.instances.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const socket = FakeSocket.instances[0];
  if (socket === undefined) throw new Error("socket was never opened");
  return socket;
};

/** A minimal, drivable fake of the DOM `WebSocket` / `EventSource` surface. */
class FakeSocket {
  static instances: Array<FakeSocket> = [];
  readyState = 1;
  binaryType = "blob";
  private listeners: Record<string, Array<(e: unknown) => void>> = {};

  constructor(
    readonly url: string,
    readonly protocols?: unknown,
  ) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, fn: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }

  closeCalls = 0;

  close(): void {
    this.closeCalls++;
    this.readyState = 3;
  }

  emit(type: string, event: unknown): void {
    for (const fn of this.listeners[type] ?? []) fn(event);
  }
}

/** A constructor that throws as `new WebSocket(url)` / `new EventSource(url)` do for an invalid URL. */
const invalidUrl = new SyntaxError("The URL 'x' is invalid.");
class ThrowingSocket {
  static attempts = 0;
  constructor() {
    ThrowingSocket.attempts++;
    throw invalidUrl;
  }
}

/**
 * Run a stream that is expected to fail and return its typed error, asserting
 * the failure is that error alone: no defect (such as a release run on a
 * resource that was never acquired) and no interruption. The timeout only
 * guards against a hang, so it fails the test rather than passing it.
 */
const runToError = async <E>(stream: Stream.Stream<unknown, E>): Promise<E> => {
  const exit = await Effect.runPromise(
    stream.pipe(Stream.runCollect, Effect.timeout("2 seconds"), Effect.exit),
  );
  if (Exit.isSuccess(exit)) throw new Error("expected the stream to fail");
  const [reason, ...rest] = exit.cause.reasons;
  expect(rest).toEqual([]);
  if (reason === undefined || !Cause.isFailReason(reason)) {
    throw new Error(`expected a typed failure, got ${Cause.pretty(exit.cause)}`);
  }
  return reason.error as E;
};

describe("Realtime.fromWebSocket", () => {
  it("fails with WebSocketError carrying the cause when the constructor throws", async () => {
    ThrowingSocket.attempts = 0;
    const error = await runToError(
      Realtime.fromWebSocket("x", { implementation: ThrowingSocket as never }),
    );
    expect(error).toBeInstanceOf(Realtime.WebSocketError);
    expect(error._tag).toBe("WebSocketError");
    expect(error.url).toBe("x");
    expect(error.cause).toBe(invalidUrl);
    expect(ThrowingSocket.attempts).toBe(1);
  });

  it("emits each message's data as a stream element", async () => {
    FakeSocket.instances = [];
    const fiber = Effect.runFork(
      Realtime.fromWebSocket("ws://x", { implementation: FakeSocket as never }).pipe(
        Stream.take(2),
        Stream.runCollect,
      ),
    );
    const socket = await awaitSocket();
    socket.emit("message", { data: "a" });
    socket.emit("message", { data: "b" });

    const result = await Effect.runPromise(Fiber.join(fiber));
    expect(result).toEqual(["a", "b"]);
  });

  it("ends the stream on a clean close", async () => {
    FakeSocket.instances = [];
    const fiber = Effect.runFork(
      Realtime.fromWebSocket("ws://x", { implementation: FakeSocket as never }).pipe(
        Stream.runCollect,
      ),
    );
    const socket = await awaitSocket();
    socket.emit("message", { data: "only" });
    socket.emit("close", { wasClean: true, code: 1000, reason: "" });

    const result = await Effect.runPromise(Fiber.join(fiber));
    expect(result).toEqual(["only"]);
  });

  it("fails with WebSocketError on an unclean close", async () => {
    FakeSocket.instances = [];
    const fiber = Effect.runFork(
      Realtime.fromWebSocket("ws://x", { implementation: FakeSocket as never }).pipe(
        Stream.runCollect,
      ),
    );
    const socket = await awaitSocket();
    socket.emit("close", { wasClean: false, code: 1006, reason: "boom" });

    const exit = await Effect.runPromise(Effect.exit(Fiber.join(fiber)));
    expect(exit._tag).toBe("Failure");
  });

  it("closes the socket when the stream fails", async () => {
    FakeSocket.instances = [];
    const fiber = Effect.runFork(
      Realtime.fromWebSocket("ws://x", { implementation: FakeSocket as never }).pipe(
        Stream.runCollect,
      ),
    );
    const socket = await awaitSocket();
    expect(socket.closeCalls).toBe(0);
    // An `error` event fails the stream while the socket is still open.
    socket.emit("error", {});

    const exit = await Effect.runPromise(Effect.exit(Fiber.join(fiber)));
    expect(exit._tag).toBe("Failure");
    expect(socket.closeCalls).toBe(1);
  });

  it("closes the socket when the stream ends", async () => {
    FakeSocket.instances = [];
    const fiber = Effect.runFork(
      Realtime.fromWebSocket("ws://x", { implementation: FakeSocket as never }).pipe(
        Stream.take(1),
        Stream.runCollect,
      ),
    );
    const socket = await awaitSocket();
    expect(socket.closeCalls).toBe(0);
    socket.emit("message", { data: "a" });

    await Effect.runPromise(Fiber.join(fiber));
    expect(socket.closeCalls).toBe(1);
  });

  it("closes the socket when the stream is interrupted", async () => {
    FakeSocket.instances = [];
    const fiber = Effect.runFork(
      Realtime.fromWebSocket("ws://x", { implementation: FakeSocket as never }).pipe(
        Stream.runCollect,
      ),
    );
    const socket = await awaitSocket();
    expect(socket.closeCalls).toBe(0);

    // `Fiber.interrupt` waits for the stream's scope to close.
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(socket.closeCalls).toBe(1);
  });

  it("does not close a socket that has already closed", async () => {
    FakeSocket.instances = [];
    const fiber = Effect.runFork(
      Realtime.fromWebSocket("ws://x", { implementation: FakeSocket as never }).pipe(
        Stream.runCollect,
      ),
    );
    const socket = await awaitSocket();
    socket.readyState = 3;
    socket.emit("close", { wasClean: true, code: 1000, reason: "" });

    await Effect.runPromise(Fiber.join(fiber));
    expect(socket.closeCalls).toBe(0);
  });
});

describe("Realtime.fromEventSource", () => {
  it("fails with EventSourceError carrying the cause when the constructor throws", async () => {
    ThrowingSocket.attempts = 0;
    const error = await runToError(
      Realtime.fromEventSource("x", {
        withCredentials: true,
        implementation: ThrowingSocket as never,
      }),
    );
    expect(error).toBeInstanceOf(Realtime.EventSourceError);
    expect(error._tag).toBe("EventSourceError");
    expect(error.url).toBe("x");
    expect(error.cause).toBe(invalidUrl);
    expect(ThrowingSocket.attempts).toBe(1);
  });

  it("emits decoded SSE messages", async () => {
    FakeSocket.instances = [];
    const fiber = Effect.runFork(
      Realtime.fromEventSource("/events", { implementation: FakeSocket as never }).pipe(
        Stream.take(1),
        Stream.runCollect,
      ),
    );
    const socket = await awaitSocket();
    socket.emit("message", { type: "message", data: "hi", lastEventId: "7" });

    const result = await Effect.runPromise(Fiber.join(fiber));
    expect(result).toEqual([{ event: "message", data: "hi", lastEventId: "7" }]);
  });

  it("listens for named events too", async () => {
    FakeSocket.instances = [];
    const fiber = Effect.runFork(
      Realtime.fromEventSource("/events", {
        events: ["tick"],
        implementation: FakeSocket as never,
      }).pipe(Stream.take(1), Stream.runCollect),
    );
    const socket = await awaitSocket();
    socket.emit("tick", { type: "tick", data: "1", lastEventId: "" });

    const result = await Effect.runPromise(Fiber.join(fiber));
    expect(result).toEqual([{ event: "tick", data: "1", lastEventId: "" }]);
  });

  it("closes the source when the stream ends", async () => {
    FakeSocket.instances = [];
    const fiber = Effect.runFork(
      Realtime.fromEventSource("/events", { implementation: FakeSocket as never }).pipe(
        Stream.take(1),
        Stream.runCollect,
      ),
    );
    const source = await awaitSocket();
    expect(source.closeCalls).toBe(0);
    source.emit("message", { type: "message", data: "hi", lastEventId: "" });

    await Effect.runPromise(Fiber.join(fiber));
    expect(source.closeCalls).toBe(1);
  });

  it("closes the source when the stream is interrupted", async () => {
    FakeSocket.instances = [];
    const fiber = Effect.runFork(
      Realtime.fromEventSource("/events", { implementation: FakeSocket as never }).pipe(
        Stream.runCollect,
      ),
    );
    const source = await awaitSocket();
    expect(source.closeCalls).toBe(0);

    // `Fiber.interrupt` waits for the stream's scope to close.
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(source.closeCalls).toBe(1);
  });
});
