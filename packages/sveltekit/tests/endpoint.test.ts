import { describe, expect, it } from "vite-plus/test";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Endpoint from "../src/server/Endpoint.js";
import { TestRequestEvent, type TestRequestEventOptions } from "../src/testing.js";

/** A SvelteKit RequestEvent for `url`; these helpers only read its `request`. */
const event = (url: string, init?: Pick<TestRequestEventOptions, "method" | "body">) =>
  TestRequestEvent({ url, ...init });

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

describe("Endpoint.fromApi per-request context", () => {
  class CurrentUser extends Context.Service<CurrentUser, { name: string }>()("test/CurrentUser") {}

  // An API whose group handler requires a per-request service.
  const UserApi = HttpApi.make("api").add(
    HttpApiGroup.make("me").add(
      HttpApiEndpoint.get("who", "/who", {
        success: Schema.Struct({ name: Schema.String }),
      }),
    ),
  );
  const MeLive = HttpApiBuilder.group(UserApi, "me", (handlers) =>
    handlers.handle("who", () => Effect.map(CurrentUser, (u) => ({ name: u.name }))),
  );

  it("provides request-scoped services via a Context resolver", async () => {
    const fallback = Endpoint.fromApi(UserApi, MeLive, {
      context: (request) =>
        Context.make(CurrentUser, { name: new URL(request.url).searchParams.get("u") ?? "?" }),
    });
    const response = await fallback(event("http://localhost/who?u=ada"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "ada" });
    await fallback.dispose();
  });

  it("provides request-scoped services via an Effect resolver", async () => {
    const fallback = Endpoint.fromApi(UserApi, MeLive, {
      context: (request) =>
        Effect.succeed(
          Context.make(CurrentUser, { name: new URL(request.url).searchParams.get("u") ?? "?" }),
        ),
    });
    const response = await fallback(event("http://localhost/who?u=grace"));
    expect(await response.json()).toEqual({ name: "grace" });
    await fallback.dispose();
  });
});

describe("Endpoint.fromRouter per-request context", () => {
  class CurrentUser extends Context.Service<CurrentUser, { name: string }>()("test/RouterUser") {}

  it("provides the router's required services per request", async () => {
    const MeLive = HttpRouter.use((router) =>
      router.add(
        "GET",
        "/me",
        Effect.map(CurrentUser, (u) => HttpServerResponse.text(`hi ${u.name}`)),
      ),
    );
    const fallback = Endpoint.fromRouter(MeLive, {
      context: () => Context.make(CurrentUser, { name: "ada" }),
    });
    const response = await fallback(event("http://localhost/me"));
    expect(await response.text()).toBe("hi ada");
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
