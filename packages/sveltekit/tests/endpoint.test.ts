import { describe, expect, it } from "vite-plus/test";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Endpoint from "../src/server/Endpoint.js";

/** A SvelteKit RequestEvent is only read for its `request` by these helpers. */
const event = (url: string, init?: RequestInit) => ({ request: new Request(url, init) }) as any;

// A tiny HttpApi: GET /hello -> { message }.
const Api = HttpApi.make("api").add(
  HttpApiGroup.make("greet").add(
    HttpApiEndpoint.get("hello", "/hello", {
      success: Schema.Struct({ message: Schema.String }),
    }),
  ),
);
const GreetLive = HttpApiBuilder.group(Api, "greet", (handlers) =>
  handlers.handle("hello", () => Effect.succeed({ message: "hello world" })),
);

describe("Endpoint.fromApi", () => {
  it("serves an HttpApi as a SvelteKit endpoint handler", async () => {
    const fallback = Endpoint.fromApi(Api, GreetLive);
    const response = await fallback(event("http://localhost/hello"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "hello world" });
    await fallback.dispose();
  });

  it("strips the mount prefix so the API's own paths match", async () => {
    const fallback = Endpoint.fromApi(Api, GreetLive, { prefix: "/api" });

    const hit = await fallback(event("http://localhost/api/hello"));
    expect(hit.status).toBe(200);
    expect(await hit.json()).toEqual({ message: "hello world" });

    // The prefix match respects path boundaries: "/apiary" is not under "/api".
    const miss = await fallback(event("http://localhost/apiary/hello"));
    expect(miss.status).toBe(404);
    await fallback.dispose();
  });
});

describe("Endpoint.fromRouter", () => {
  it("serves an HttpRouter, forwarding request bodies through a stripped prefix", async () => {
    const EchoLive = HttpRouter.use((router) =>
      router.add(
        "POST",
        "/echo",
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          return HttpServerResponse.text(`echo:${yield* request.text}`);
        }),
      ),
    );

    const fallback = Endpoint.fromRouter(EchoLive, { prefix: "/api" });
    const response = await fallback(
      event("http://localhost/api/echo", { method: "POST", body: "hi" }),
    );
    expect(await response.text()).toBe("echo:hi");
    await fallback.dispose();
  });
});

describe("Endpoint.fromHttpEffect", () => {
  it("serves a single HTTP route effect", async () => {
    const GET = Endpoint.fromHttpEffect(Effect.succeed(HttpServerResponse.text("ok")));
    const response = await GET(event("http://localhost/health"));
    expect(await response.text()).toBe("ok");
  });
});
