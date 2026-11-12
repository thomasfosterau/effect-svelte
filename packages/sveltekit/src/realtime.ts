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

import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as P from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { failQueueOnSetupError } from "./internal/stream-callback.js";

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

/**
 * Raised when an `EventSource` cannot be opened (its constructor throws, e.g.
 * for an invalid URL; `cause` holds the thrown value) or its connection fails
 * fatally (its `readyState` is `CLOSED`; `cause` is absent).
 */
export class EventSourceError extends Schema.TaggedError<EventSourceError>()("EventSourceError", {
  /** The URL the `EventSource` was opened with. */
  url: Schema.String,
  /** What the `EventSource` constructor threw, when that is why the stream failed. */
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/** The fields of a server-sent event's `MessageEvent` that {@link fromEventSource} reads. */
export type EventSourceMessage = Pick<MessageEvent<string>, "type" | "data" | "lastEventId">;

/**
 * The subset of an `EventSource` instance {@link fromEventSource} relies on.
 * The platform `EventSource` is one; so is a polyfill or a test double with
 * these members.
 */
export interface EventSourceLike {
  /** `2` once the source has closed for good. */
  readonly readyState: number;
  /** Registers a listener for the `message`, `error` or a named event. */
  addEventListener(type: string, listener: (event: EventSourceMessage) => void): void;
  /** Closes the connection. */
  close(): void;
}

/** The subset of the `EventSource` constructor this module relies on. */
export type EventSourceConstructor = new (
  url: string,
  eventSourceInitDict?: { withCredentials?: boolean },
) => EventSourceLike;

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

/** A listener that offers each event it receives to `queue` as an {@link SseMessage}. */
const offerSseMessage =
  (queue: Queue.Queue<SseMessage, EventSourceError | Cause.Done>) =>
  (e: EventSourceMessage): void => {
    Queue.offerUnsafe(queue, { event: e.type, data: e.data, lastEventId: e.lastEventId });
  };

/**
 * Consume a Server-Sent-Events endpoint as a `Stream` of {@link SseMessage}.
 *
 * The browser's `EventSource` reconnects automatically after transient drops,
 * so the stream stays live across reconnects. It fails with
 * {@link EventSourceError} when the connection closes fatally, or, with the
 * thrown value as its `cause`, when the `EventSource` constructor throws (e.g.
 * a `SyntaxError` for an invalid URL). The source is closed when the stream's
 * scope closes; one that failed to construct has nothing to close.
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
  const Impl: EventSourceConstructor = options?.implementation ?? globalThis.EventSource;
  // Effect v4's `Stream.callback` runs the returned Effect as the stream's
  // setup, inside the stream's scope; it is not a cleanup. Open the source
  // with `acquireRelease` so it is closed when that scope closes.
  return Stream.callback<SseMessage, EventSourceError>(
    (queue) =>
      Effect.acquireRelease(
        // Construct and attach the listeners in one synchronous step, so no
        // event can be dispatched in between; a throw from either (in practice
        // the constructor) becomes the typed error. A failed acquire registers
        // no release: a source that failed to construct has nothing to close.
        Effect.try({
          try: () => {
            const source =
              options?.withCredentials === undefined
                ? new Impl(url)
                : new Impl(url, { withCredentials: options.withCredentials });

            // One listener for every event name, so a name listed twice (or
            // `"message"` in `events`) is registered once.
            const onMessage = offerSseMessage(queue);

            source.addEventListener("message", onMessage);
            Arr.forEach(options?.events ?? [], (name) => source.addEventListener(name, onMessage));

            source.addEventListener("error", () => {
              // EventSource reconnects on its own unless it has closed for good.
              if (source.readyState === 2 /* CLOSED */) {
                Queue.failCauseUnsafe(queue, Cause.fail(new EventSourceError({ url })));
              }
            });

            return source;
          },
          catch: (cause) => new EventSourceError({ url, cause }),
        }),
        (source) => Effect.sync(() => source.close()),
      ).pipe(failQueueOnSetupError(queue)),
    { bufferSize: options?.bufferSize ?? 16, strategy: options?.strategy ?? "sliding" },
  );
};

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

/**
 * Raised when a `WebSocket` cannot be opened (its constructor throws, e.g. for
 * an invalid URL or protocol list; `cause` holds the thrown value), errors, or
 * closes uncleanly (`code` and `reason` come from the close event).
 */
export class WebSocketError extends Schema.TaggedError<WebSocketError>()("WebSocketError", {
  /** The URL the `WebSocket` was opened with. */
  url: Schema.String,
  /** The close code, when an unclean close is why the stream failed. */
  code: Schema.optionalKey(Schema.Number),
  /** The close reason, when an unclean close is why the stream failed. */
  reason: Schema.optionalKey(Schema.String),
  /** What the `WebSocket` constructor threw, when that is why the stream failed. */
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/**
 * The subset of a `WebSocket` instance {@link fromWebSocket} relies on. The
 * platform `WebSocket` is one; so is a polyfill or a test double with these
 * members.
 */
export interface WebSocketLike {
  /** How binary frames are delivered; set from `options.binaryType`. */
  binaryType: BinaryType;
  /** `0` while connecting and `1` while open: the states in which the socket is closed on release. */
  readonly readyState: number;
  /** Registers the listener for incoming messages. */
  addEventListener(type: "message", listener: (event: Pick<MessageEvent, "data">) => void): void;
  /** Registers the listener for a connection error. */
  addEventListener(type: "error", listener: () => void): void;
  /** Registers the listener for the connection closing. */
  addEventListener(
    type: "close",
    listener: (event: Pick<CloseEvent, "wasClean" | "code" | "reason">) => void,
  ): void;
  /** Closes the connection. */
  close(): void;
}

/** The subset of the `WebSocket` constructor this module relies on. */
export type WebSocketConstructor = new (
  url: string,
  protocols?: string | ReadonlyArray<string>,
) => WebSocketLike;

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

/** `protocols` as the platform `WebSocket` constructor types it: a list as a mutable `string[]`. */
const mutableProtocols = (protocols: FromWebSocketOptions["protocols"]) =>
  P.isString(protocols) || protocols === undefined ? protocols : Arr.fromIterable(protocols);

/**
 * Consume a `WebSocket` as a `Stream` of its message payloads
 * (`string | ArrayBuffer | Blob`, depending on `binaryType`).
 *
 * The stream ends when the socket closes cleanly. It fails with
 * {@link WebSocketError} on an error or unclean close, or, with the thrown
 * value as its `cause`, when the `WebSocket` constructor throws (e.g. a
 * `SyntaxError` for an invalid URL or protocol list). The socket is closed when
 * the stream's scope closes; one that failed to construct has nothing to close.
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
  // The platform constructor is read here, as `implementation` is.
  const Platform = globalThis.WebSocket;
  return Stream.callback<string | ArrayBuffer | Blob, WebSocketError>(
    (queue) =>
      Effect.acquireRelease(
        // See `fromEventSource`: construct and attach the listeners in one
        // synchronous step, mapping a throw to the typed error; a failed
        // acquire registers no release.
        Effect.try({
          try: () => {
            const socket: WebSocketLike =
              options?.implementation === undefined
                ? new Platform(url, mutableProtocols(options?.protocols))
                : new options.implementation(url, options.protocols);
            if (options?.binaryType !== undefined) socket.binaryType = options.binaryType;

            socket.addEventListener("message", (e) => {
              Queue.offerUnsafe(queue, e.data);
            });

            socket.addEventListener("error", () => {
              Queue.failCauseUnsafe(queue, Cause.fail(new WebSocketError({ url })));
            });

            socket.addEventListener("close", (e) => {
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
          },
          catch: (cause) => new WebSocketError({ url, cause }),
        }),
        (socket) =>
          Effect.sync(() => {
            // Only close a socket that is still connecting/open.
            if (socket.readyState === 0 || socket.readyState === 1) socket.close();
          }),
      ).pipe(failQueueOnSetupError(queue)),
    { bufferSize: options?.bufferSize ?? 16, strategy: options?.strategy ?? "suspend" },
  );
};
