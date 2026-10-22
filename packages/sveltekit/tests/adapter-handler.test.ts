import { describe, expect, it } from "vite-plus/test";
import type { Server, ServerInitOptions } from "@sveltejs/kit";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpServer from "effect/http/HttpServer";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { makeHandler, type SvelteKitHandlerOptions } from "../src/adapter/handler.js";

/**
 * Fake SvelteKit Server that records init options and echoes request details
 * back as JSON, marking SSR responses with an `x-ssr` header.
 */
let lastInitOptions: ServerInitOptions | undefined;

class FakeServer implements Server {
  async init(options: ServerInitOptions): Promise<void> {
    lastInitOptions = options;
  }

  async respond(request: Request, options: { getClientAddress(): string }): Promise<Response> {
    const body = request.method === "POST" ? await request.text() : null;
    return Response.json(
      {
        url: request.url,
        method: request.method,
        body,
        clientAddress: options.getClientAddress(),
      },
      { headers: { "content-type": "application/json", "x-ssr": "1" } },
    );
  }
}

/** The request details {@link FakeServer} echoes back from SSR. */
const EchoedRequest = Schema.Struct({
  url: Schema.String,
  method: Schema.String,
  body: Schema.NullOr(Schema.String),
  clientAddress: Schema.String,
});

const decodeEchoedRequest = Schema.decodeUnknownEffect(EchoedRequest);

/** Create a fake build output directory with client assets and prerendered pages. */
const makeBuildDir = Effect.fn("makeBuildDir")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "effect-handler-test-" });
  yield* fs.makeDirectory(path.join(dir, "client", "_app", "immutable", "chunks"), {
    recursive: true,
  });
  yield* fs.makeDirectory(path.join(dir, "prerendered", "blog"), { recursive: true });
  yield* fs.makeDirectory(path.join(dir, "server"), { recursive: true });

  yield* fs.writeFileString(path.join(dir, "client", "favicon.png"), "fake-favicon");
  yield* fs.writeFileString(
    path.join(dir, "client", "_app", "immutable", "chunks", "app.js"),
    "console.log(1)",
  );
  yield* fs.writeFileString(path.join(dir, "prerendered", "about.html"), "<html>about</html>");
  yield* fs.writeFileString(path.join(dir, "prerendered", "index.html"), "<html>home</html>");
  yield* fs.writeFileString(
    path.join(dir, "prerendered", "blog", "index.html"),
    "<html>blog</html>",
  );
  yield* fs.writeFileString(path.join(dir, "server", "asset.txt"), "server-asset");

  return dir;
});

/** Boot the handler on a test server and return the pre-configured HttpClient. */
const testClient = (options?: Partial<SvelteKitHandlerOptions>) =>
  Effect.gen(function* () {
    const app = yield* makeHandler({
      server: new FakeServer(),
      appPath: "_app",
      prerendered: ["/about", "/", "/blog/"],
      base: "",
      dir: yield* makeBuildDir(),
      env: { FROM_TEST: "yes" },
      ...options,
    });
    yield* HttpServer.serveEffect(app);
    return yield* HttpClient.HttpClient;
  });

const run = <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> => Effect.runPromise(effect);

const withTestServer = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient | HttpServer.HttpServer>,
  options?: Partial<SvelteKitHandlerOptions>,
): Promise<A> =>
  run(
    Effect.gen(function* () {
      const client = yield* testClient(options);
      return yield* Effect.provideService(effect, HttpClient.HttpClient, client);
    }).pipe(Effect.scoped, Effect.provide(NodeHttpServer.layerTest)),
  );

describe("makeHandler", () => {
  it("initialises the SvelteKit server with the provided env", async () => {
    await withTestServer(Effect.void);
    expect(lastInitOptions?.env).toEqual({ FROM_TEST: "yes" });
  });

  it("serves static client assets", async () => {
    const { status, text } = await withTestServer(
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        const response = yield* client.get("/favicon.png");
        return { status: response.status, text: yield* response.text };
      }),
    );
    expect(status).toBe(200);
    expect(text).toBe("fake-favicon");
  });

  it("serves immutable assets with long-lived cache headers", async () => {
    const headers = await withTestServer(
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        const response = yield* client.get("/_app/immutable/chunks/app.js");
        expect(response.status).toBe(200);
        return response.headers;
      }),
    );
    expect(headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("does not set immutable cache headers on regular assets", async () => {
    const headers = await withTestServer(
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        const response = yield* client.get("/favicon.png");
        return response.headers;
      }),
    );
    expect(headers["cache-control"]).toBeUndefined();
  });

  it("serves prerendered pages", async () => {
    const text = await withTestServer(
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        const response = yield* client.get("/about");
        expect(response.status).toBe(200);
        return yield* response.text;
      }),
    );
    expect(text).toBe("<html>about</html>");
  });

  it("serves the prerendered root page", async () => {
    const text = await withTestServer(
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        const response = yield* client.get("/");
        return yield* response.text;
      }),
    );
    expect(text).toBe("<html>home</html>");
  });

  it("serves prerendered directory-style pages", async () => {
    const text = await withTestServer(
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        const response = yield* client.get("/blog/");
        return yield* response.text;
      }),
    );
    expect(text).toBe("<html>blog</html>");
  });

  it("falls back to SSR for non-prerendered routes", async () => {
    const body = await withTestServer(
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        const response = yield* client.get("/dynamic/route?q=1");
        expect(response.status).toBe(200);
        expect(response.headers["x-ssr"]).toBe("1");
        return yield* decodeEchoedRequest(yield* response.json);
      }),
    );
    expect(body.url).toMatch(/\/dynamic\/route\?q=1$/);
    expect(body.method).toBe("GET");
  });

  it("forwards request bodies to SSR", async () => {
    const body = await withTestServer(
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        const response = yield* client.post("/api/things", {
          body: HttpBody.text("hello from the test"),
        });
        return yield* decodeEchoedRequest(yield* response.json);
      }),
    );
    expect(body.body).toBe("hello from the test");
    expect(body.method).toBe("POST");
  });

  it("provides the client address to SSR", async () => {
    const body = await withTestServer(
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        const response = yield* client.get("/whoami");
        return yield* decodeEchoedRequest(yield* response.json);
      }),
    );
    expect(body.clientAddress).toMatch(/127\.0\.0\.1|::1|::ffff/);
  });

  it("respects the ORIGIN configuration for SSR request URLs", async () => {
    const body = await run(
      Effect.gen(function* () {
        const client = yield* testClient();
        const response = yield* client.get("/some/page");
        return yield* decodeEchoedRequest(yield* response.json);
      }).pipe(
        Effect.scoped,
        Effect.provide(NodeHttpServer.layerTest),
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnv({ env: { ORIGIN: "https://example.com" } }),
        ),
      ),
    );
    expect(body.url).toBe("https://example.com/some/page");
  });

  it("does not allow path traversal outside the client directory", async () => {
    const response = await withTestServer(
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        // URL-encoded `../../server/asset.txt`; a normalising client would
        // collapse the path, so encode the dots to hit the server raw.
        return yield* client.get("/%2e%2e/%2e%2e/server/asset.txt");
      }),
    );
    // Must not return the file contents: it falls through to SSR (which echoes
    // JSON) rather than serving the file outside of client/.
    expect(response.headers["x-ssr"]).toBe("1");
  });
});
