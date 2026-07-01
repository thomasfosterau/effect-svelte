import { describe, expect, it } from "vite-plus/test";
import { Effect, Layer, Tracer } from "effect";
import { makeServerRuntime } from "../src/app-runtime.js";
import { makeRuntimeAdapter, RequestRuntime } from "../src/request-runtime.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeMockEvent = (routeId: string | null = "/test", method = "GET"): any => ({
  route: { id: routeId },
  request: new Request(`http://localhost/${routeId ?? ""}`, { method }),
  url: new URL("http://localhost/"),
  params: {},
  cookies: {
    get: () => undefined,
    getAll: () => [],
    set: () => {},
    delete: () => {},
    serialize: (n: string, v: string) => `${n}=${v}`,
  },
  locals: {},
  fetch: globalThis.fetch,
  setHeaders: () => {},
  isDataRequest: false,
  isSubRequest: false,
  platform: undefined,
  getClientAddress: () => "127.0.0.1",
});

type CapturedSpan = { name: string; kind: string };

const makeTestTracerLayer = (spans: CapturedSpan[]): Layer.Layer<never> =>
  Layer.succeed(
    Tracer.Tracer,
    Tracer.make({
      span: (options) => {
        spans.push({ name: options.name, kind: options.kind });
        return new Tracer.NativeSpan(options);
      },
    }),
  );

// ─── makeServerRuntime spans ──────────────────────────────────────────────────

describe("makeServerRuntime span names", () => {
  it("serverLoad span name includes route id", async () => {
    const spans: CapturedSpan[] = [];
    const runtime = makeServerRuntime(makeTestTracerLayer(spans));

    const event = makeMockEvent("/items/[id]");
    const result = await runtime.serverLoad(() => Effect.succeed({ ok: true }))(event);

    expect(result).toEqual({ ok: true });
    expect(spans.some((s) => s.name === "serverLoad /items/[id]")).toBe(true);
  });

  it("action span name includes route id", async () => {
    const spans: CapturedSpan[] = [];
    const runtime = makeServerRuntime(makeTestTracerLayer(spans));

    const event = makeMockEvent("/items/[id]");
    await runtime.action(() => Effect.succeed({ created: true }))(event);

    expect(spans.some((s) => s.name === "action /items/[id]")).toBe(true);
  });

  it("endpoint span name uses HTTP method and route id", async () => {
    const spans: CapturedSpan[] = [];
    const runtime = makeServerRuntime(makeTestTracerLayer(spans));

    const event = makeMockEvent("/api/items", "POST");
    await runtime.endpoint(() => Effect.succeed(new Response("ok")))(event);

    expect(spans.some((s) => s.name === "POST /api/items")).toBe(true);
  });

  it("spans use kind=server", async () => {
    const spans: CapturedSpan[] = [];
    const runtime = makeServerRuntime(makeTestTracerLayer(spans));

    const event = makeMockEvent("/items");
    await runtime.serverLoad(() => Effect.succeed({ ok: true }))(event);

    const span = spans.find((s) => s.name.startsWith("serverLoad"));
    expect(span?.kind).toBe("server");
  });

  it("null route id falls back to (unknown)", async () => {
    const spans: CapturedSpan[] = [];
    const runtime = makeServerRuntime(makeTestTracerLayer(spans));

    const event = makeMockEvent(null);
    await runtime.serverLoad(() => Effect.succeed({}))(event);

    expect(spans.some((s) => s.name === "serverLoad (unknown)")).toBe(true);
  });

  it("handler result is returned correctly with spans active", async () => {
    const spans: CapturedSpan[] = [];
    const runtime = makeServerRuntime(makeTestTracerLayer(spans));

    const event = makeMockEvent("/data");
    const result = await runtime.serverLoad(() => Effect.succeed({ value: 42 }))(event);

    expect(result).toEqual({ value: 42 });
  });
});

// ─── makeRuntimeAdapter spans ─────────────────────────────────────────────────

describe("makeRuntimeAdapter span names", () => {
  it("serverLoad span name includes route id", async () => {
    const spans: CapturedSpan[] = [];
    const adapter = makeRuntimeAdapter(RequestRuntime.fromLayer(makeTestTracerLayer(spans)));

    const event = makeMockEvent("/posts/[slug]");
    const result = await adapter.serverLoad(() => Effect.succeed({ posts: [] }))(event);

    expect(result).toEqual({ posts: [] });
    expect(spans.some((s) => s.name === "serverLoad /posts/[slug]")).toBe(true);
  });

  it("action span name includes route id", async () => {
    const spans: CapturedSpan[] = [];
    const adapter = makeRuntimeAdapter(RequestRuntime.fromLayer(makeTestTracerLayer(spans)));

    const event = makeMockEvent("/submit");
    await adapter.action(() => Effect.succeed({ ok: true }))(event);

    expect(spans.some((s) => s.name === "action /submit")).toBe(true);
  });

  it("endpoint span name uses HTTP method and route id", async () => {
    const spans: CapturedSpan[] = [];
    const adapter = makeRuntimeAdapter(RequestRuntime.fromLayer(makeTestTracerLayer(spans)));

    const event = makeMockEvent("/api/users", "DELETE");
    await adapter.endpoint(() => Effect.succeed(new Response("deleted")))(event);

    expect(spans.some((s) => s.name === "DELETE /api/users")).toBe(true);
  });
});
