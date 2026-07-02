/**
 * Server-Sent Events framing helpers, factored out of the endpoint wrapper so
 * the wire format can be unit-tested in isolation.
 *
 * See the [SSE specification](https://html.spec.whatwg.org/multipage/server-sent-events.html).
 */

/** The response headers required for a `text/event-stream` body. */
export const SSE_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

/** The fields of a single SSE event. */
export interface SseFrame {
  /** The event payload. Multi-line strings are split into multiple `data:` lines. */
  readonly data: string;
  /** Optional event name (`event:` field). */
  readonly event?: string | undefined;
  /** Optional event id (`id:` field), which the browser echoes on reconnect. */
  readonly id?: string | undefined;
}

/**
 * Encode a single SSE event as its wire representation, terminated by the
 * blank line that dispatches it.
 *
 * `data` is split on newlines into one `data:` line each (per the spec, a bare
 * newline in a value would otherwise be ambiguous). `event` / `id` are emitted
 * only when present.
 */
export const encodeSseFrame = (frame: SseFrame): string => {
  let out = "";
  if (frame.id !== undefined) out += `id: ${frame.id}\n`;
  if (frame.event !== undefined) out += `event: ${frame.event}\n`;
  // Split into per-line `data:` fields so embedded newlines survive.
  for (const line of frame.data.split("\n")) out += `data: ${line}\n`;
  out += "\n";
  return out;
};

/** Encode the one-shot `retry:` field that sets the client reconnection delay. */
export const encodeRetry = (milliseconds: number): string => `retry: ${milliseconds}\n\n`;

/** A comment line used as a heartbeat/keepalive (ignored by the client). */
export const HEARTBEAT_FRAME = ": heartbeat\n\n";
