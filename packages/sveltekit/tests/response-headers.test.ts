/**
 * `ResponseHeaders` — the response-headers buffer the applications hand-wrote
 * (`lib/cache.ts` + the `transport` in `hooks.ts`).
 */
import * as Schema from "effect/Schema";
import { assert, describe, expect, it } from "vite-plus/test";
import { responseHeadersTransporter } from "../src/Hooks.js";
import { ResponseHeaders } from "../src/response-headers.js";
import { transport } from "../src/transport.js";

const toJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

describe("ResponseHeaders", () => {
  it("serialises to an empty JSON object (SvelteKit Transport survival)", () => {
    const headers = new ResponseHeaders({ "X-Foo": "bar" });
    expect(headers.toJSON()).toEqual({});
    expect(toJson(headers)).toBe("{}");
  });

  it("still behaves as a real Headers underneath", () => {
    const headers = new ResponseHeaders({ "X-Foo": "bar" });
    expect(headers).toBeInstanceOf(globalThis.Headers);
    expect(headers.get("X-Foo")).toBe("bar");
  });

  it("appends every buffered header onto a response, keeping each set-cookie", () => {
    const buffer = new ResponseHeaders();
    buffer.append("set-cookie", "a=1; Path=/");
    buffer.append("set-cookie", "b=2; Path=/");
    buffer.set("cache-control", "private, max-age=0");
    const response = new Response("ok", { headers: { "x-existing": "yes" } });

    buffer.appendTo(response.headers);

    expect(response.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    expect(response.headers.get("cache-control")).toBe("private, max-age=0");
    expect(response.headers.get("x-existing")).toBe("yes");
  });
});

describe("responseHeadersTransporter", () => {
  it("claims ResponseHeaders only, and decodes to a fresh empty buffer", () => {
    const hooks = transport({ ResponseHeaders: responseHeadersTransporter });
    const entry = hooks["ResponseHeaders"];
    assert(entry !== undefined, "expected the ResponseHeaders transporter");

    expect(entry.encode(new globalThis.Headers())).toBe(false);
    expect(entry.encode({})).toBe(false);
    const encoded = entry.encode(new ResponseHeaders({ "set-cookie": "secret=1" }));
    expect(encoded).toBeTruthy();
    // The contents never leave the server.
    expect(toJson(encoded)).not.toContain("secret");

    const decoded = entry.decode(encoded);
    expect(decoded).toBeInstanceOf(ResponseHeaders);
    expect([...decoded]).toEqual([]);
  });
});
