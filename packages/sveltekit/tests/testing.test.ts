import { describe, expect, it } from "vite-plus/test";
import { isHttpError, isRedirect } from "@sveltejs/kit";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  TestRequestEvent,
  runServerLoad,
  runAction,
  runEndpoint,
  runRemote,
} from "../src/testing.js";
import { SvelteKit } from "../src/kit.js";

// ─── TestRequestEvent ─────────────────────────────────────────────────────────

describe("TestRequestEvent", () => {
  it("defaults to GET http://localhost/", () => {
    const event = TestRequestEvent();
    expect(event.request.method).toBe("GET");
    expect(event.url.href).toBe("http://localhost/");
    expect(event.params).toEqual({});
    expect(event.route).toEqual({ id: null });
    expect(event.isDataRequest).toBe(false);
    expect(event.isSubRequest).toBe(false);
  });

  it("accepts a string URL", () => {
    const event = TestRequestEvent({ url: "http://localhost/items/42" });
    expect(event.url.pathname).toBe("/items/42");
  });

  it("accepts a URL instance", () => {
    const event = TestRequestEvent({ url: new URL("http://localhost/api") });
    expect(event.url.pathname).toBe("/api");
  });

  it("forwards method and headers", () => {
    const event = TestRequestEvent({
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(event.request.method).toBe("POST");
    expect(event.request.headers.get("content-type")).toBe("application/json");
  });

  it("sets params and locals", () => {
    const event = TestRequestEvent({
      params: { id: "99" },
      locals: { user: { id: "u1" } },
    });
    expect((event.params as any).id).toBe("99");
    expect((event.locals as any).user).toEqual({ id: "u1" });
  });

  it("cookies: get returns pre-seeded values", () => {
    const event = TestRequestEvent({ cookies: { session: "abc123" } });
    expect(event.cookies.get("session")).toBe("abc123");
  });

  it("cookies: set and get within the same event", () => {
    const event = TestRequestEvent();
    event.cookies.set("token", "xyz", { path: "/" });
    expect(event.cookies.get("token")).toBe("xyz");
  });

  it("cookies: delete removes a cookie", () => {
    const event = TestRequestEvent({ cookies: { tok: "v" } });
    event.cookies.delete("tok", { path: "/" });
    expect(event.cookies.get("tok")).toBeUndefined();
  });

  it("cookies: getAll returns all cookies", () => {
    const event = TestRequestEvent({ cookies: { a: "1", b: "2" } });
    const all = event.cookies.getAll();
    expect(all).toHaveLength(2);
    expect(all.find((c) => c.name === "a")?.value).toBe("1");
  });

  it("accepts a custom fetch function", async () => {
    const mockFetch = async () => new Response("mocked");
    const event = TestRequestEvent({ fetch: mockFetch as any });
    const res = await event.fetch("http://example.com");
    expect(await res.text()).toBe("mocked");
  });

  it("getClientAddress returns 127.0.0.1", () => {
    const event = TestRequestEvent();
    expect(event.getClientAddress()).toBe("127.0.0.1");
  });

  it("setHeaders is a no-op and does not throw", () => {
    const event = TestRequestEvent();
    expect(() => event.setHeaders({ "x-test": "1" })).not.toThrow();
  });
});

// ─── Test services ────────────────────────────────────────────────────────────

class Counter extends Context.Service<
  Counter,
  { increment: () => Effect.Effect<void>; value: () => Effect.Effect<number> }
>()("testing/Counter") {}

/** Factory: each call produces a layer with independent mutable state. */
const makeCounterLayer = (): Layer.Layer<Counter> => {
  let n = 0;
  return Layer.succeed(Counter, {
    increment: () =>
      Effect.sync(() => {
        n++;
      }),
    value: () => Effect.sync(() => n),
  });
};

// ─── runServerLoad ────────────────────────────────────────────────────────────

describe("runServerLoad", () => {
  it("returns the effect's success value", async () => {
    const event = TestRequestEvent({ params: { id: "7" } });
    const data = await runServerLoad((e) => Effect.succeed({ id: (e.params as any).id }), event);
    expect(data).toEqual({ id: "7" });
  });

  it("provides services from opts.layer", async () => {
    const event = TestRequestEvent();
    const data = await runServerLoad(
      (_event) =>
        Effect.gen(function* () {
          const counter = yield* Counter;
          yield* counter.increment();
          return { count: yield* counter.value() };
        }),
      event,
      { layer: makeCounterLayer() },
    );
    expect(data).toEqual({ count: 1 });
  });

  it("translates KitRedirect → redirect() throw", async () => {
    const event = TestRequestEvent();
    await expect(runServerLoad(() => SvelteKit.redirect(302, "/login"), event)).rejects.toSatisfy(
      (e: unknown) => isRedirect(e),
    );
  });

  it("translates KitError → error() throw", async () => {
    const event = TestRequestEvent();
    await expect(runServerLoad(() => SvelteKit.error(404, "Not found"), event)).rejects.toSatisfy(
      (e: unknown) => isHttpError(e) && (e as any).status === 404,
    );
  });

  it("wraps unrecognised failures in EffectCauseError", async () => {
    const event = TestRequestEvent();
    await expect(runServerLoad(() => Effect.fail("oops"), event)).rejects.toMatchObject({
      name: "EffectCauseError",
    });
  });

  it("honours a custom translateError", async () => {
    class AppError {
      readonly _tag = "AppError" as const;
      constructor(readonly message: string) {}
    }
    const { error } = await import("@sveltejs/kit");
    const translateError = SvelteKit.makeTranslator([
      (e) => {
        if (e instanceof AppError) error(503, e.message);
      },
    ]);

    const event = TestRequestEvent();
    await expect(
      runServerLoad(() => Effect.fail(new AppError("down")), event, { translateError }),
    ).rejects.toSatisfy((e: unknown) => isHttpError(e) && (e as any).status === 503);
  });
});

// ─── runAction ───────────────────────────────────────────────────────────────

describe("runAction", () => {
  it("returns the effect's success value", async () => {
    const event = TestRequestEvent({ method: "POST" });
    const result = await runAction((_event) => Effect.succeed({ created: true }), event);
    expect(result).toEqual({ created: true });
  });

  it("provides services from opts.layer", async () => {
    const event = TestRequestEvent({ method: "POST" });
    const result = await runAction(
      (_event) =>
        Effect.gen(function* () {
          const counter = yield* Counter;
          yield* counter.increment();
          return { count: yield* counter.value() };
        }),
      event,
      { layer: makeCounterLayer() },
    );
    expect((result as any).count).toBe(1);
  });

  it("translates KitActionFailure → ActionFailure return", async () => {
    const event = TestRequestEvent({ method: "POST" });
    const result = await runAction(() => SvelteKit.fail(422, { email: "taken" }), event);
    expect((result as any).status).toBe(422);
    expect((result as any).data).toEqual({ email: "taken" });
  });

  it("throws on KitError", async () => {
    const event = TestRequestEvent({ method: "POST" });
    await expect(runAction(() => SvelteKit.error(403, "Forbidden"), event)).rejects.toSatisfy(
      (e: unknown) => isHttpError(e) && (e as any).status === 403,
    );
  });
});

// ─── runEndpoint ──────────────────────────────────────────────────────────────

describe("runEndpoint", () => {
  it("returns the Response on success", async () => {
    const event = TestRequestEvent({ url: "http://localhost/api/ping" });
    const response = await runEndpoint(
      (_event) => Effect.succeed(new Response(JSON.stringify({ ok: true }), { status: 200 })),
      event,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("provides services from opts.layer", async () => {
    const event = TestRequestEvent();
    const response = await runEndpoint(
      (_event) =>
        Effect.gen(function* () {
          const counter = yield* Counter;
          yield* counter.increment();
          return new Response(JSON.stringify({ count: yield* counter.value() }));
        }),
      event,
      { layer: makeCounterLayer() },
    );
    expect(await response.json()).toEqual({ count: 1 });
  });

  it("KitRedirect throws for SvelteKit to handle", async () => {
    const event = TestRequestEvent();
    await expect(
      runEndpoint(() => SvelteKit.redirect(302, "/redirected"), event),
    ).rejects.toSatisfy(isRedirect);
  });

  it("KitError throws for SvelteKit to handle", async () => {
    const event = TestRequestEvent();
    await expect(runEndpoint(() => SvelteKit.error(404, "nope"), event)).rejects.toSatisfy(
      isHttpError,
    );
  });

  it("unrecognised error returns 500 Response", async () => {
    const event = TestRequestEvent();
    const response = await runEndpoint(() => Effect.fail("boom"), event);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
  });
});

// ─── runRemote ────────────────────────────────────────────────────────────────

describe("runRemote", () => {
  it("run executes the effect and returns the value", async () => {
    const event = TestRequestEvent();
    const { run } = runRemote(event);
    const result = await run(Effect.succeed(42));
    expect(result).toBe(42);
  });

  it("run provides services from opts.layer", async () => {
    const event = TestRequestEvent();
    const { run } = runRemote(event, { layer: makeCounterLayer() });
    const result = await run(
      Effect.gen(function* () {
        const counter = yield* Counter;
        yield* counter.increment();
        yield* counter.increment();
        return yield* counter.value();
      }),
    );
    expect(result).toBe(2);
  });

  it("run translates KitRedirect → redirect() throw", async () => {
    const event = TestRequestEvent();
    const { run } = runRemote(event);
    await expect(run(SvelteKit.redirect(302, "/away"))).rejects.toSatisfy(isRedirect);
  });

  it("run translates KitError → error() throw", async () => {
    const event = TestRequestEvent();
    const { run } = runRemote(event);
    await expect(run(SvelteKit.error(401, "Unauthorized"))).rejects.toSatisfy(
      (e: unknown) => isHttpError(e) && (e as any).status === 401,
    );
  });

  it("runForm returns success value", async () => {
    const event = TestRequestEvent();
    const { runForm } = runRemote(event);
    const result = await runForm(Effect.succeed({ saved: true }), {
      issue: {} as any,
      data: {},
    });
    expect(result).toEqual({ saved: true });
  });

  it("runForm calls formError on failure", async () => {
    const event = TestRequestEvent();
    let capturedError: unknown;
    const { runForm } = runRemote(event, {
      formError: (err, _ctx) => {
        capturedError = err;
        throw new Error("form invalid");
      },
    });
    await expect(
      runForm(Effect.fail(new Error("validation failed")), { issue: {} as any, data: {} }),
    ).rejects.toThrow("form invalid");
    expect(capturedError).toBeInstanceOf(Error);
    expect((capturedError as Error).message).toBe("validation failed");
  });

  it("runForm falls back to translateError when no formError provided", async () => {
    const event = TestRequestEvent();
    const { runForm } = runRemote(event);
    await expect(
      runForm(SvelteKit.error(503, "Service unavailable"), { issue: {} as any, data: {} }),
    ).rejects.toSatisfy((e: unknown) => isHttpError(e) && (e as any).status === 503);
  });

  it("each runRemote call gets an independent runtime", async () => {
    const event = TestRequestEvent();
    const { run: run1 } = runRemote(event, { layer: makeCounterLayer() });
    const { run: run2 } = runRemote(event, { layer: makeCounterLayer() });

    await run1(
      Effect.gen(function* () {
        yield* (yield* Counter).increment();
      }),
    );

    // run2 has a fresh Counter instance — its count is still 0
    const v2 = await run2(
      Effect.gen(function* () {
        return yield* (yield* Counter).value();
      }),
    );
    expect(v2).toBe(0);
  });

  it("honours a custom translateError", async () => {
    class ServiceUnavailable {
      readonly _tag = "ServiceUnavailable" as const;
    }
    const { error } = await import("@sveltejs/kit");
    const translateError = SvelteKit.makeTranslator([
      (e) => {
        if (e instanceof ServiceUnavailable) error(503, "unavailable");
      },
    ]);

    const event = TestRequestEvent();
    const { run } = runRemote(event, { translateError });
    await expect(run(Effect.fail(new ServiceUnavailable()))).rejects.toSatisfy(
      (e: unknown) => isHttpError(e) && (e as any).status === 503,
    );
  });
});

// ─── Layer-injection round-trip ────────────────────────────────────────────────

describe("Layer injection round-trip", () => {
  it("runServerLoad and runRemote can share the same test layer", async () => {
    const event = TestRequestEvent({ params: { id: "5" } });

    const loadData = await runServerLoad(
      (e) =>
        Effect.gen(function* () {
          const counter = yield* Counter;
          yield* counter.increment();
          return { id: (e.params as any).id, count: yield* counter.value() };
        }),
      event,
      { layer: makeCounterLayer() },
    );
    expect(loadData.count).toBe(1);

    // runRemote has its own layer instance — fresh count
    const { run } = runRemote(event, { layer: makeCounterLayer() });
    const count = await run(
      Effect.gen(function* () {
        return yield* (yield* Counter).value();
      }),
    );
    expect(count).toBe(0);
  });
});
