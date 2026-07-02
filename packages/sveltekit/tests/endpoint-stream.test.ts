import { describe, expect, it } from "vite-plus/test";
import type { RequestEvent } from "@sveltejs/kit";
import { Stream } from "effect";
import * as Endpoint from "../src/server/Endpoint.js";

/** A minimal RequestEvent carrying just the request the handler reads. */
const eventFor = (url = "http://localhost/events"): RequestEvent =>
  ({ request: new Request(url) }) as unknown as RequestEvent;

/** Invoke a stream endpoint handler and read its whole SSE body as text. */
const readBody = async (handler: ReturnType<typeof Endpoint.fromStream>): Promise<string> => {
  const response = await handler(eventFor());
  return await response.text();
};

describe("Endpoint.fromStream", () => {
  it("sets text/event-stream headers", async () => {
    const handler = Endpoint.fromStream(Stream.make(1));
    const response = await handler(eventFor());
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toContain("no-cache");
  });

  it("frames each element as a JSON data event by default", async () => {
    const handler = Endpoint.fromStream(Stream.make(1, 2, 3));
    expect(await readBody(handler)).toBe("data: 1\n\ndata: 2\n\ndata: 3\n\n");
  });

  it("applies a static event name", async () => {
    const handler = Endpoint.fromStream(Stream.make("a", "b"), { event: "tick" });
    expect(await readBody(handler)).toBe('event: tick\ndata: "a"\n\nevent: tick\ndata: "b"\n\n');
  });

  it("uses a custom data encoder and id", async () => {
    const handler = Endpoint.fromStream(Stream.make(1, 2), {
      data: (n) => `n=${n}`,
      id: (n) => String(n),
    });
    expect(await readBody(handler)).toBe("id: 1\ndata: n=1\n\nid: 2\ndata: n=2\n\n");
  });

  it("prepends a one-shot retry field", async () => {
    const handler = Endpoint.fromStream(Stream.make(1), { retry: 3000 });
    expect(await readBody(handler)).toBe("retry: 3000\n\ndata: 1\n\n");
  });

  it("derives the event name per element", async () => {
    const handler = Endpoint.fromStream(Stream.make({ kind: "add" }, { kind: "remove" }), {
      event: (v) => v.kind,
      data: (v) => v.kind,
    });
    expect(await readBody(handler)).toBe(
      "event: add\ndata: add\n\nevent: remove\ndata: remove\n\n",
    );
  });
});
