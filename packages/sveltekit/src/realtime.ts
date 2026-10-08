/**
 * Client-side realtime bridges: consume a Server-Sent-Events endpoint or a
 * WebSocket as an Effect `Stream`. The counterpart to `Endpoint.fromStream`
 * (server) on the `@thomasfosterau/effect-sveltekit/client` `Realtime` namespace.
 *
 * These use the browser globals `EventSource` / `WebSocket`; both can be
 * overridden (e.g. a Node polyfill, or a fake in tests) via the `implementation`
 * option. The source is opened when the stream is run and closed when its scope
 * closes, so a `Stream.take` / component teardown tears down the connection.
 */

import { Cause, Data, Effect, Queue, Stream } from "effect";

// ---------------------------------------------------------------------------
// EventSource
// ---------------------------------------------------------------------------

/** A decoded Server-Sent Event. */
export interface SseMessage {
  /** The event name (`"message"` for unnamed events). */
  readonly event: string;
  /** The event payload (the joined `data:` lines). */
  readonly data: string;
  /** The last event id seen, or `""` if none. */
  readonly lastEventId: string;
}

/** Raised when an `EventSource` connection fails fatally (its `readyState` is `CLOSED`). */
export class EventSourceError extends Data.TaggedError("EventSourceError")<{
  readonly url: string;
}> {}

/** The subset of the `EventSource` constructor this module relies on. */
export type EventSourceConstructor = new (
  url: string,
  eventSourceInitDict?: { withCredentials?: boolean },
) => EventSource;

/** Options for {@link fromEventSource}. */
export interface FromEventSourceOptions {
  /** Send credentials (cookies) with the request. Defaults to `false`. */
  readonly withCredentials?: boolean;
  /**
   * Named events to listen for in addition to the default unnamed `message`
   * event. An `Endpoint.fromStream({ event: "tick" })` server needs
   * `events: ["tick"]` here.
   */
  readonly events?: ReadonlyArray<string>;
  /** Buffer size for the backing queue. Defaults to 16. */
  readonly bufferSize?: number;
  /** Backpressure strategy when the buffer is full. Defaults to `"sliding"`. */
  readonly strategy?: "sliding" | "dropping" | "suspend";
  /** Override the `EventSource` constructor (Node polyfill, tests). */
  readonly implementation?: EventSourceConstructor;
}

/**
 * Consume a Server-Sent-Events endpoint as a `Stream` of {@link SseMessage}.
 *
 * The browser's `EventSource` reconnects automatically after transient drops,
 * so the stream stays live across reconnects; it fails with
 * {@link EventSourceError} only when the connection closes fatally. The source
 * is closed when the stream's scope closes.
 *
 * @example
 * ```ts
 * import { Realtime } from "@thomasfosterau/effect-sveltekit/client";
 * import { Effect, Stream } from "effect";
 *
 * const program = Realtime.fromEventSource("/events", { events: ["tick"] }).pipe(
 *   Stream.runForEach((msg) => Effect.log(`${msg.event}: ${msg.data}`)),
 * );
 * ```
 */
export const fromEventSource = (
  url: string,
  options?: FromEventSourceOptions,
): Stream.Stream<SseMessage, EventSourceError> => {
  const Impl = options?.implementation ?? (globalThis.EventSource as EventSourceConstructor);
  // Effect v4's `Stream.callback` runs the returned Effect as the stream's
  // setup, inside the stream's scope; it is not a cleanup. Open the source
  // with `acquireRelease` so it is closed when that scope closes.
  return Stream.callback<SseMessage, EventSourceError>(
    (queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const source =
            options?.withCredentials === undefined
              ? new Impl(url)
              : new Impl(url, { withCredentials: options.withCredentials });

          const onMessage = (e: MessageEvent): void => {
            Queue.offerUnsafe(queue, { event: e.type, data: e.data, lastEventId: e.lastEventId });
          };

          source.addEventListener("message", onMessage);
          for (const name of options?.events ?? []) source.addEventListener(name, onMessage);

          source.addEventListener("error", () => {
            // EventSource reconnects on its own unless it has closed for good.
            if (source.readyState === 2 /* CLOSED */) {
              Queue.failCauseUnsafe(queue, Cause.fail(new EventSourceError({ url })));
            }
          });

          return source;
        }),
        (source) => Effect.sync(() => source.close()),
      ),
    { bufferSize: options?.bufferSize ?? 16, strategy: options?.strategy ?? "sliding" },
  );
};

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

/** Raised when a `WebSocket` errors or closes uncleanly. */
export class WebSocketError extends Data.TaggedError("WebSocketError")<{
  readonly url: string;
  readonly code?: number;
  readonly reason?: string;
}> {}

/** The subset of the `WebSocket` constructor this module relies on. */
export type WebSocketConstructor = new (
  url: string,
  protocols?: string | ReadonlyArray<string>,
) => WebSocket;

/** Options for {@link fromWebSocket}. */
export interface FromWebSocketOptions {
  /** Sub-protocols passed to the `WebSocket` constructor. */
  readonly protocols?: string | ReadonlyArray<string>;
  /** `arraybuffer` or `blob` for binary frames. Defaults to the platform default. */
  readonly binaryType?: BinaryType;
  /** Buffer size for the backing queue. Defaults to 16. */
  readonly bufferSize?: number;
  /** Backpressure strategy when the buffer is full. Defaults to `"suspend"`. */
  readonly strategy?: "sliding" | "dropping" | "suspend";
  /** Override the `WebSocket` constructor (Node polyfill, tests). */
  readonly implementation?: WebSocketConstructor;
}

/**
 * Consume a `WebSocket` as a `Stream` of its message payloads
 * (`string | ArrayBuffer | Blob`, depending on `binaryType`).
 *
 * The stream ends when the socket closes cleanly and fails with
 * {@link WebSocketError} on an error or unclean close. The socket is closed when
 * the stream's scope closes.
 *
 * @example
 * ```ts
 * import { Realtime } from "@thomasfosterau/effect-sveltekit/client";
 * import { Effect, Stream } from "effect";
 *
 * const program = Realtime.fromWebSocket("wss://example.com/ws").pipe(
 *   Stream.runForEach((data) => Effect.log(String(data))),
 * );
 * ```
 */
export const fromWebSocket = (
  url: string,
  options?: FromWebSocketOptions,
): Stream.Stream<string | ArrayBuffer | Blob, WebSocketError> => {
  const Impl = options?.implementation ?? (globalThis.WebSocket as WebSocketConstructor);
  // See `fromEventSource`: the socket is opened with `acquireRelease` so it is
  // closed when the stream's scope closes.
  return Stream.callback<string | ArrayBuffer | Blob, WebSocketError>(
    (queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const socket = new Impl(url, options?.protocols);
          if (options?.binaryType !== undefined) socket.binaryType = options.binaryType;

          socket.addEventListener("message", (e: MessageEvent) => {
            Queue.offerUnsafe(queue, e.data);
          });

          socket.addEventListener("error", () => {
            Queue.failCauseUnsafe(queue, Cause.fail(new WebSocketError({ url })));
          });

          socket.addEventListener("close", (e: CloseEvent) => {
            if (e.wasClean) {
              Queue.endUnsafe(queue);
            } else {
              Queue.failCauseUnsafe(
                queue,
                Cause.fail(new WebSocketError({ url, code: e.code, reason: e.reason })),
              );
            }
          });

          return socket;
        }),
        (socket) =>
          Effect.sync(() => {
            // Only close a socket that is still connecting/open.
            if (socket.readyState === 0 || socket.readyState === 1) socket.close();
          }),
      ),
    { bufferSize: options?.bufferSize ?? 16, strategy: options?.strategy ?? "suspend" },
  );
};
