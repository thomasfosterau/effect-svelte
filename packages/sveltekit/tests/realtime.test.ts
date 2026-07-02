import { describe, expect, it } from "vite-plus/test";
import { Effect, Fiber, Stream } from "effect";
import * as Realtime from "../src/realtime.js";

/** Yields to the event loop so the forked stream fiber opens the socket. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

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

  close(): void {
    this.readyState = 3;
  }

  emit(type: string, event: unknown): void {
    for (const fn of this.listeners[type] ?? []) fn(event);
  }
}

describe("Realtime.fromWebSocket", () => {
  it("emits each message's data as a stream element", async () => {
    FakeSocket.instances = [];
    const fiber = Effect.runFork(
      Realtime.fromWebSocket("ws://x", { implementation: FakeSocket as never }).pipe(
        Stream.take(2),
        Stream.runCollect,
      ),
    );
    await flush();

    const socket = FakeSocket.instances[0]!;
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
    await flush();

    const socket = FakeSocket.instances[0]!;
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
    await flush();

    FakeSocket.instances[0]!.emit("close", { wasClean: false, code: 1006, reason: "boom" });

    const exit = await Effect.runPromise(Effect.exit(Fiber.join(fiber)));
    expect(exit._tag).toBe("Failure");
  });
});

describe("Realtime.fromEventSource", () => {
  it("emits decoded SSE messages", async () => {
    FakeSocket.instances = [];
    const fiber = Effect.runFork(
      Realtime.fromEventSource("/events", { implementation: FakeSocket as never }).pipe(
        Stream.take(1),
        Stream.runCollect,
      ),
    );
    await flush();

    FakeSocket.instances[0]!.emit("message", { type: "message", data: "hi", lastEventId: "7" });

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
    await flush();

    FakeSocket.instances[0]!.emit("tick", { type: "tick", data: "1", lastEventId: "" });

    const result = await Effect.runPromise(Fiber.join(fiber));
    expect(result).toEqual([{ event: "tick", data: "1", lastEventId: "" }]);
  });
});
