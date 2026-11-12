import { describe, expect, it } from "vite-plus/test";
import type { RequestEvent } from "@sveltejs/kit";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Endpoint from "../src/server/Endpoint.js";
import { TestRequestEvent } from "../src/testing.js";

/** A RequestEvent for `url`; the handler reads only its request. */
const eventFor = (url = "http://localhost/events"): RequestEvent => TestRequestEvent({ url });

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
      id: (n) => Option.some(String(n)),
    });
    expect(await readBody(handler)).toBe("id: 1\ndata: n=1\n\nid: 2\ndata: n=2\n\n");
  });

  it("prepends a one-shot retry field", async () => {
    const handler = Endpoint.fromStream(Stream.make(1), { retry: 3000 });
    expect(await readBody(handler)).toBe("retry: 3000\n\ndata: 1\n\n");
  });

  it("derives the event name per element", async () => {
    const handler = Endpoint.fromStream(Stream.make({ kind: "add" }, { kind: "remove" }), {
      event: (v) => Option.some(v.kind),
      data: (v) => v.kind,
    });
    expect(await readBody(handler)).toBe(
      "event: add\ndata: add\n\nevent: remove\ndata: remove\n\n",
    );
  });

  it("omits the event field for an element whose event callback returns None", async () => {
    const handler = Endpoint.fromStream(Stream.make("add", "plain", "remove"), {
      event: (kind) => (kind === "plain" ? Option.none() : Option.some(kind)),
      data: (kind) => kind,
    });
    expect(await readBody(handler)).toBe(
      "event: add\ndata: add\n\ndata: plain\n\nevent: remove\ndata: remove\n\n",
    );
  });

  it("omits the id field for an element whose id callback returns None", async () => {
    const handler = Endpoint.fromStream(Stream.make(1, 2, 3), {
      event: "n",
      id: (n) => (n === 2 ? Option.none() : Option.some(String(n))),
    });
    expect(await readBody(handler)).toBe(
      "id: 1\nevent: n\ndata: 1\n\nevent: n\ndata: 2\n\nid: 3\nevent: n\ndata: 3\n\n",
    );
  });
});
