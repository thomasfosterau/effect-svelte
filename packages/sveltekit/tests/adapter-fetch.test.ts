import { describe, expect, it } from "vite-plus/test";
import type { Server, ServerInitOptions } from "@sveltejs/kit";
import * as Layer from "effect/Layer";
import { AssetSource, makeHandlerWith, toWebHandler } from "../src/adapter/handler.js";

/** Fake SvelteKit Server: echoes SSR request details, marks them with x-ssr. */
class FakeServer implements Server {
  async init(_options: ServerInitOptions): Promise<void> {}
  async respond(request: Request): Promise<Response> {
    return Response.json(
      { url: request.url, method: request.method },
      {
        headers: { "content-type": "application/json", "x-ssr": "1" },
      },
    );
  }
}

/** A fake Cloudflare static-assets binding: serves /asset.txt, 404 otherwise. */
const fakeAssets = {
  fetch: async (request: Request): Promise<Response> => {
    if (new URL(request.url).pathname === "/asset.txt") {
      return new Response("static-asset", { status: 200 });
    }
    return new Response("not found", { status: 404 });
  },
};

const makeFetch = () =>
  toWebHandler(
    makeHandlerWith({
      server: new FakeServer(),
      env: { FROM_TEST: "yes" },
      assets: AssetSource.cloudflareAssets(fakeAssets),
      read: () => {
        throw new Error("read() not supported in this test");
      },
    }),
    Layer.empty,
  );

describe("toWebHandler with AssetSource.cloudflareAssets", () => {
  it("serves an asset from the Cloudflare assets binding", async () => {
    const fetchHandler = makeFetch();
    const response = await fetchHandler(new Request("http://localhost/asset.txt"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("static-asset");
    // Not an SSR response.
    expect(response.headers.get("x-ssr")).toBeNull();
  });

  it("falls through to SSR when the asset binding returns 404", async () => {
    const fetchHandler = makeFetch();
    const response = await fetchHandler(new Request("http://localhost/dynamic/route?q=1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-ssr")).toBe("1");
    expect((await response.json()).url).toMatch(/\/dynamic\/route\?q=1$/);
  });

  it("does not consult the asset binding for non-GET/HEAD requests", async () => {
    const fetchHandler = makeFetch();
    const response = await fetchHandler(
      new Request("http://localhost/asset.txt", { method: "POST" }),
    );
    // A POST to an asset path is SSR'd, not served as a static asset.
    expect(response.headers.get("x-ssr")).toBe("1");
    expect((await response.json()).method).toBe("POST");
  });

  it("supports a custom AssetSource", async () => {
    const fetchHandler = toWebHandler(
      makeHandlerWith({
        server: new FakeServer(),
        assets: AssetSource.cloudflareAssets({
          fetch: async (request) =>
            new URL(request.url).pathname === "/custom"
              ? new Response("from-custom", { status: 200 })
              : new Response(null, { status: 404 }),
        }),
        read: () => {
          throw new Error("read() not supported");
        },
      }),
      Layer.empty,
    );
    const response = await fetchHandler(new Request("http://localhost/custom"));
    expect(await response.text()).toBe("from-custom");
  });
});
