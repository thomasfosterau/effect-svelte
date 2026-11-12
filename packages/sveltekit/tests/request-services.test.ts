import { it } from "@effect/vitest";
import { describe, expect } from "vite-plus/test";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as MutableHashMap from "effect/MutableHashMap";
import * as Option from "effect/Option";
import type { Cookies, RequestEvent } from "@sveltejs/kit";
import {
  SvelteKitCookies,
  SvelteKitLocals,
  SvelteKitResponseHeaders,
  requestServicesFrom,
  requestServicesLayer,
} from "../src/request-services.js";
import { SvelteKitRequestEvent } from "../src/runtime.js";
import { mockEvent } from "./fixtures/request-event.js";
import { ForeignError } from "./fixtures/foreign-error.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

type MockCookieStore = MutableHashMap.MutableHashMap<string, string>;

const makeMockCookies = (store: MockCookieStore = MutableHashMap.empty()): Cookies => ({
  get: (name) => Option.getOrUndefined(MutableHashMap.get(store, name)),
  getAll: () => Arr.map(Arr.fromIterable(store), ([name, value]) => ({ name, value })),
  set: (name, value) => {
    MutableHashMap.set(store, name, value);
  },
  delete: (name) => {
    MutableHashMap.remove(store, name);
  },
  parse: () => {
    throw new ForeignError("cookies.parse is not mocked");
  },
  serialize: (name, value) => `${name}=${encodeURIComponent(value)}`,
});

const makeMockEvent = (
  opts: {
    cookies?: MockCookieStore;
    locals?: App.Locals;
    setHeaders?: (h: Record<string, string>) => void;
  } = {},
): RequestEvent =>
  mockEvent({
    cookies: makeMockCookies(opts.cookies),
    locals: opts.locals,
    setHeaders: opts.setHeaders,
  });

/** `locals` a test lets an effect write a flag on. */
interface MutableLocals {
  mutated?: boolean;
}

const run = <A, R>(effect: Effect.Effect<A, never, R>, layer: Layer.Layer<R>): Effect.Effect<A> =>
  Effect.provide(effect, layer);

// ─── SvelteKitCookies via Layer ───────────────────────────────────────────────

describe("SvelteKitCookies (mock layer)", () => {
  const makeMockCookiesLayer = () =>
    Layer.succeed(SvelteKitCookies, {
      get: (name) => Effect.succeed(name === "session" ? "tok123" : undefined),
      getAll: () => Effect.succeed([{ name: "session", value: "tok123" }]),
      set: () => Effect.void,
      delete: () => Effect.void,
      serialize: (n, v) => Effect.succeed(`${n}=${v}`),
    });

  it.effect("get returns the stubbed value", () =>
    Effect.gen(function* () {
      const value = yield* run(
        Effect.gen(function* () {
          const cookies = yield* SvelteKitCookies;
          return yield* cookies.get("session");
        }),
        makeMockCookiesLayer(),
      );
      expect(value).toBe("tok123");
    }),
  );

  it.effect("get returns undefined for absent cookie", () =>
    Effect.gen(function* () {
      const value = yield* run(
        Effect.gen(function* () {
          const cookies = yield* SvelteKitCookies;
          return yield* cookies.get("nope");
        }),
        makeMockCookiesLayer(),
      );
      expect(value).toBeUndefined();
    }),
  );

  it.effect("getAll returns the stubbed list", () =>
    Effect.gen(function* () {
      const all = yield* run(
        Effect.gen(function* () {
          const cookies = yield* SvelteKitCookies;
          return yield* cookies.getAll();
        }),
        makeMockCookiesLayer(),
      );
      expect(all).toEqual([{ name: "session", value: "tok123" }]);
    }),
  );

  it.effect("set Effect executes side-effect", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const layer = Layer.succeed(SvelteKitCookies, {
        get: () => Effect.succeed(undefined),
        getAll: () => Effect.succeed([]),
        set: (name) =>
          Effect.sync(() => {
            calls.push(name);
          }),
        delete: () => Effect.void,
        serialize: (n, v) => Effect.succeed(`${n}=${v}`),
      });

      yield* run(
        Effect.gen(function* () {
          const cookies = yield* SvelteKitCookies;
          yield* cookies.set("x", "1", { path: "/" });
        }),
        layer,
      );
      expect(calls).toEqual(["x"]);
    }),
  );
});

// ─── SvelteKitCookies via SvelteKitRequestEvent layer ────────────────────────

describe("SvelteKitCookies.layer (from SvelteKitRequestEvent)", () => {
  it.effect("get reads from the event's cookies", () =>
    Effect.gen(function* () {
      const store = MutableHashMap.make(["token", "abc"]);
      const event = makeMockEvent({ cookies: store });

      const value = yield* run(
        Effect.gen(function* () {
          const cookies = yield* SvelteKitCookies;
          return yield* cookies.get("token");
        }),
        Layer.provide(SvelteKitCookies.layer, Layer.succeed(SvelteKitRequestEvent, event)),
      );
      expect(value).toBe("abc");
    }),
  );

  it.effect("set writes to the event's cookies", () =>
    Effect.gen(function* () {
      const store = MutableHashMap.empty<string, string>();
      const event = makeMockEvent({ cookies: store });

      yield* run(
        Effect.gen(function* () {
          const cookies = yield* SvelteKitCookies;
          yield* cookies.set("newKey", "newVal", { path: "/" });
        }),
        Layer.provide(SvelteKitCookies.layer, Layer.succeed(SvelteKitRequestEvent, event)),
      );
      expect(MutableHashMap.get(store, "newKey")).toEqual(Option.some("newVal"));
    }),
  );

  it.effect("getAll returns all cookies from the event", () =>
    Effect.gen(function* () {
      const store = MutableHashMap.make(["a", "1"], ["b", "2"]);
      const event = makeMockEvent({ cookies: store });

      const all = yield* run(
        Effect.gen(function* () {
          const cookies = yield* SvelteKitCookies;
          return yield* cookies.getAll();
        }),
        Layer.provide(SvelteKitCookies.layer, Layer.succeed(SvelteKitRequestEvent, event)),
      );
      expect(all).toHaveLength(2);
      expect(all.some((c) => c.name === "a" && c.value === "1")).toBe(true);
      expect(all.some((c) => c.name === "b" && c.value === "2")).toBe(true);
    }),
  );

  it.effect("serialize returns name=value string", () =>
    Effect.gen(function* () {
      const event = makeMockEvent();

      const result = yield* run(
        Effect.gen(function* () {
          const cookies = yield* SvelteKitCookies;
          return yield* cookies.serialize("k", "hello world", { path: "/" });
        }),
        Layer.provide(SvelteKitCookies.layer, Layer.succeed(SvelteKitRequestEvent, event)),
      );
      expect(result).toContain("k=");
    }),
  );
});

// ─── SvelteKitResponseHeaders ─────────────────────────────────────────────────

describe("SvelteKitResponseHeaders (mock layer)", () => {
  it.effect("set Effect executes side-effect", () =>
    Effect.gen(function* () {
      const captured: Array<Record<string, string>> = [];
      const layer = Layer.succeed(SvelteKitResponseHeaders, {
        set: (h) =>
          Effect.sync(() => {
            captured.push(h);
          }),
      });

      yield* run(
        Effect.gen(function* () {
          const headers = yield* SvelteKitResponseHeaders;
          yield* headers.set({ "cache-control": "max-age=60" });
        }),
        layer,
      );
      expect(captured).toEqual([{ "cache-control": "max-age=60" }]);
    }),
  );
});

describe("SvelteKitResponseHeaders.layer (from SvelteKitRequestEvent)", () => {
  it.effect("set delegates to event.setHeaders", () =>
    Effect.gen(function* () {
      const captured: Array<Record<string, string>> = [];
      const event = makeMockEvent({ setHeaders: (h) => captured.push(h) });

      yield* run(
        Effect.gen(function* () {
          const headers = yield* SvelteKitResponseHeaders;
          yield* headers.set({ "x-custom": "yes" });
        }),
        Layer.provide(SvelteKitResponseHeaders.layer, Layer.succeed(SvelteKitRequestEvent, event)),
      );
      expect(captured).toEqual([{ "x-custom": "yes" }]);
    }),
  );
});

// ─── SvelteKitLocals ──────────────────────────────────────────────────────────

describe("SvelteKitLocals (mock layer)", () => {
  it.effect("yields the mocked locals object", () =>
    Effect.gen(function* () {
      const mockLocals = { user: "alice" };
      const layer = Layer.succeed(SvelteKitLocals, mockLocals);

      const locals = yield* run(
        Effect.gen(function* () {
          return yield* SvelteKitLocals;
        }),
        layer,
      );
      expect(locals).toBe(mockLocals);
    }),
  );
});

describe("SvelteKitLocals.layer (from SvelteKitRequestEvent)", () => {
  it.effect("returns the same object reference as event.locals", () =>
    Effect.gen(function* () {
      const eventLocals = { user: "bob" };
      const event = makeMockEvent({ locals: eventLocals });

      const locals = yield* run(
        Effect.gen(function* () {
          return yield* SvelteKitLocals;
        }),
        Layer.provide(SvelteKitLocals.layer, Layer.succeed(SvelteKitRequestEvent, event)),
      );
      expect(locals).toBe(event.locals);
    }),
  );

  it.effect("mutations inside effect are visible on event.locals", () =>
    Effect.gen(function* () {
      const eventLocals: MutableLocals = {};
      const event = makeMockEvent({ locals: eventLocals });

      yield* run(
        Effect.gen(function* () {
          const locals = yield* SvelteKitLocals;
          Reflect.set(locals, "mutated", true);
        }),
        Layer.provide(SvelteKitLocals.layer, Layer.succeed(SvelteKitRequestEvent, event)),
      );
      expect(event.locals).toBe(eventLocals);
      expect(eventLocals.mutated).toBe(true);
    }),
  );
});

// ─── requestServicesLayer ─────────────────────────────────────────────────────

describe("requestServicesLayer", () => {
  it.effect("provides all three services from SvelteKitRequestEvent", () =>
    Effect.gen(function* () {
      const store = MutableHashMap.make(["tok", "xyz"]);
      const captured: Array<Record<string, string>> = [];
      const eventLocals = { role: "admin" };
      const event = makeMockEvent({
        cookies: store,
        setHeaders: (h) => captured.push(h),
        locals: eventLocals,
      });

      const result = yield* run(
        Effect.gen(function* () {
          const cookies = yield* SvelteKitCookies;
          const headers = yield* SvelteKitResponseHeaders;
          const locals = yield* SvelteKitLocals;
          const cookieVal = yield* cookies.get("tok");
          yield* headers.set({ "x-role": "admin" });
          return { cookieVal, locals };
        }),
        Layer.provide(requestServicesLayer, Layer.succeed(SvelteKitRequestEvent, event)),
      );

      expect(result.cookieVal).toBe("xyz");
      expect(result.locals).toBe(event.locals);
      expect(captured).toEqual([{ "x-role": "admin" }]);
    }),
  );
});

// ─── requestServicesFrom ──────────────────────────────────────────────────────

describe("requestServicesFrom", () => {
  it("builds all three service interfaces from a RequestEvent", () => {
    const store = MutableHashMap.make(["s", "v"]);
    const event = makeMockEvent({ cookies: store });
    const services = requestServicesFrom(event);

    expect(services.cookies).toBeDefined();
    expect(services.responseHeaders).toBeDefined();
    expect(services.locals).toBe(event.locals);
  });

  it.effect("cookies.get reads from event cookies synchronously via Effect", () =>
    Effect.gen(function* () {
      const store = MutableHashMap.make(["k", "val"]);
      const event = makeMockEvent({ cookies: store });
      const { cookies } = requestServicesFrom(event);

      const value = yield* cookies.get("k");
      expect(value).toBe("val");
    }),
  );

  it.effect("responseHeaders.set calls event.setHeaders via Effect", () =>
    Effect.gen(function* () {
      const captured: Array<Record<string, string>> = [];
      const event = makeMockEvent({ setHeaders: (h) => captured.push(h) });
      const { responseHeaders } = requestServicesFrom(event);

      yield* responseHeaders.set({ "cache-control": "no-store" });
      expect(captured).toEqual([{ "cache-control": "no-store" }]);
    }),
  );
});
