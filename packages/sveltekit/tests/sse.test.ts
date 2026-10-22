import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { encodeRetry, encodeSseFrame } from "../src/internal/sse.js";

describe("encodeSseFrame", () => {
  it("encodes a bare data frame terminated by a blank line", () => {
    expect(encodeSseFrame({ data: "hello" })).toBe("data: hello\n\n");
  });

  it("includes the event name when present", () => {
    expect(encodeSseFrame({ data: "hi", event: "tick" })).toBe("event: tick\ndata: hi\n\n");
  });

  it("includes the id, before the event, when present", () => {
    expect(encodeSseFrame({ data: "hi", event: "tick", id: "42" })).toBe(
      "id: 42\nevent: tick\ndata: hi\n\n",
    );
  });

  it("splits multi-line data into multiple data: lines", () => {
    expect(encodeSseFrame({ data: "line1\nline2" })).toBe("data: line1\ndata: line2\n\n");
  });

  it("encodes JSON payloads as a single data line", () => {
    const payload = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))({ a: 1, b: "x" });
    expect(encodeSseFrame({ data: payload })).toBe(`data: ${payload}\n\n`);
  });
});

describe("encodeRetry", () => {
  it("emits a retry field terminated by a blank line", () => {
    expect(encodeRetry(3000)).toBe("retry: 3000\n\n");
  });
});
