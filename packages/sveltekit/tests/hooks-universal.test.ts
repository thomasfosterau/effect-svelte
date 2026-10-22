import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import { reroute, transport, transporter } from "../src/Hooks.js";

const rerouteEvent = (pathname: string) => ({
  url: new URL(`http://localhost${pathname}`),
  fetch,
});

describe("Hooks.reroute", () => {
  it("rewrites the URL based on the event", async () => {
    const hook = reroute((event) =>
      Effect.succeed(event.url.pathname === "/old" ? "/new" : undefined),
    );
    expect(await hook(rerouteEvent("/old"))).toBe("/new");
    expect(await hook(rerouteEvent("/keep"))).toBeUndefined();
  });

  it("provides an HttpClient backed by the event fetch", async () => {
    const hook = reroute(() =>
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        return client !== undefined ? "/has-client" : "/no-client";
      }),
    );
    expect(await hook(rerouteEvent("/"))).toBe("/has-client");
  });
});

describe("Hooks.transport", () => {
  it("re-exports the transport helpers", () => {
    expect(typeof transport).toBe("function");
    expect(typeof transporter).toBe("function");
  });
});
