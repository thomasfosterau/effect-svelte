import { describe, expect, it } from "vite-plus/test";
import { error, isHttpError, isRedirect, redirect, type RequestEvent } from "@sveltejs/kit";
import type { Handle } from "@sveltejs/kit/hooks";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as R from "effect/Record";
import * as HttpClient from "effect/http/HttpClient";
import { makeServerRuntime, makeUniversalRuntime } from "../src/app-runtime.js";
import { EffectCauseError } from "../src/internal/error.js";
import {
  wrapAction,
  wrapActions,
  wrapEndpoint,
  wrapHandle,
  wrapHandleError,
  wrapHandleFetch,
  wrapInit,
  wrapLoad,
  wrapReroute,
  wrapServerLoad,
} from "../src/internal/auto.js";
import { mockEvent, mockLoadEvent } from "./fixtures/request-event.js";

describe("wrapServerLoad", () => {
  it("returns undefined when value is undefined", () => {
    expect(wrapServerLoad(undefined)).toBeUndefined();
  });

  it("runs an effect-returning function", async () => {
    const fn = wrapServerLoad((event: RequestEvent) =>
      Effect.succeed({ ok: true, url: event.url.toString() }),
    );
    const result = await fn(mockEvent());
    expect(result).toEqual({ ok: true, url: "http://localhost/" });
  });

  it("runs a bare Effect value", async () => {
    const fn = wrapServerLoad(Effect.succeed({ from: "effect" }));
    const result = await fn(mockEvent());
    expect(result).toEqual({ from: "effect" });
  });

  it("passes through plain-function returns", async () => {
    const fn = wrapServerLoad(() => ({ plain: true }));
    const result = await fn(mockEvent());
    expect(result).toEqual({ plain: true });
  });

  it("passes through promise-returning functions", async () => {
    const fn = wrapServerLoad(async () => ({ async: true }));
    const result = await fn(mockEvent());
    expect(result).toEqual({ async: true });
  });

  it("throws an EffectCauseError on failure", async () => {
    const fn = wrapServerLoad(() => Effect.fail("boom"));
    await expect(fn(mockEvent())).rejects.toThrow(EffectCauseError);
  });

  it("passes redirect() through to SvelteKit", async () => {
    const fn = wrapServerLoad(() =>
      Effect.sync((): void => {
        redirect(302, "/elsewhere");
      }),
    );
    await expect(fn(mockEvent())).rejects.toSatisfy(
      (thrown) => isRedirect(thrown) && thrown.location === "/elsewhere",
    );
  });

  it("passes error() through to SvelteKit", async () => {
    const fn = wrapServerLoad(() =>
      Effect.sync((): void => {
        error(404, "Not found");
      }),
    );
    await expect(fn(mockEvent())).rejects.toSatisfy(
      (thrown) => isHttpError(thrown) && thrown.status === 404,
    );
  });

  it("provides HttpClient from the runtime", async () => {
    const fn = wrapServerLoad(() =>
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        return { hasClient: client !== undefined };
      }),
    );
    const result = await fn(mockEvent());
    expect(result).toEqual({ hasClient: true });
  });
});

describe("wrapLoad (universal)", () => {
  it("runs effects on client-style events (no request)", async () => {
    const fn = wrapLoad(() => Effect.succeed({ universal: true }));
    const result = await fn(mockLoadEvent());
    expect(result).toEqual({ universal: true });
  });

  it("provides HttpClient on client-style events via the event fetch", async () => {
    const fn = wrapLoad(() =>
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        return { hasClient: client !== undefined };
      }),
    );
    const result = await fn(mockLoadEvent());
    expect(result).toEqual({ hasClient: true });
  });
});

describe("wrapAction", () => {
  it("wraps a single action", async () => {
    const fn = wrapAction(() => Effect.succeed({ created: 1 }));
    const result = await fn(mockEvent());
    expect(result).toEqual({ created: 1 });
  });
});

describe("wrapActions", () => {
  it("wraps each entry in an actions object", async () => {
    const actions = wrapActions({
      create: () => Effect.succeed({ created: true }),
      remove: async () => ({ removed: true }),
    });
    expect(actions).not.toBeUndefined();
    const createResult = await actions.create(mockEvent());
    expect(createResult).toEqual({ created: true });
    const removeResult = await actions.remove(mockEvent());
    expect(removeResult).toEqual({ removed: true });
  });

  it("returns undefined for undefined input", () => {
    expect(wrapActions(undefined)).toBeUndefined();
  });

  it("drops an entry that holds undefined", async () => {
    const actions = wrapActions({
      create: () => Effect.succeed({ created: true }),
      remove: undefined,
    });
    expect(R.keys(actions)).toEqual(["create"]);
    expect(await actions.create(mockEvent())).toEqual({ created: true });
  });
});

describe("an export that holds undefined", () => {
  it("stays undefined through every wrapper", () => {
    expect(wrapLoad(undefined)).toBeUndefined();
    expect(wrapServerLoad(undefined)).toBeUndefined();
    expect(wrapAction(undefined)).toBeUndefined();
    expect(wrapActions(undefined)).toBeUndefined();
    expect(wrapHandle(undefined)).toBeUndefined();
    expect(wrapHandleFetch(undefined)).toBeUndefined();
    expect(wrapHandleError(undefined)).toBeUndefined();
    expect(wrapEndpoint(undefined)).toBeUndefined();
    expect(wrapReroute(undefined)).toBeUndefined();
    expect(wrapInit(undefined)).toBeUndefined();
  });
});

/** A server `load` export that needs no services. */
const loadOk = () => Effect.succeed({ ok: true });

describe("the default runtimes", () => {
  it("run a server export with no runtime module, and with a module that exports none", async () => {
    expect(await wrapServerLoad(loadOk)(mockEvent())).toEqual({ ok: true });
    expect(await wrapServerLoad(loadOk, {})(mockEvent())).toEqual({ ok: true });
  });

  it("ignore a runtime module of the other kind", async () => {
    // A universal runtime handed to a server wrapper is not a server runtime,
    // so the export runs on the default server runtime instead.
    const fn = wrapServerLoad(() => Effect.succeed({ ok: true }), {
      runtime: makeUniversalRuntime(),
    });
    expect(await fn(mockEvent())).toEqual({ ok: true });
    const universal = wrapLoad(() => Effect.succeed({ ok: true }), {
      runtime: makeServerRuntime(),
    });
    expect(await universal(mockLoadEvent())).toEqual({ ok: true });
  });
});

describe("wrapHandle", () => {
  it("runs an effect-returning hook", async () => {
    const handle = wrapHandle(({ event, resolve }: Parameters<Handle>[0]) =>
      Effect.tryPromise(() => resolve(event)),
    );
    const resolved = new Response("ok");
    const result = await handle({
      event: mockEvent(),
      resolve: async () => resolved,
    });
    expect(result).toBe(resolved);
  });

  it("passes plain handle through", async () => {
    const handle = wrapHandle(async ({ resolve, event }: Parameters<Handle>[0]) => resolve(event));
    const resolved = new Response("plain");
    const result = await handle({
      event: mockEvent(),
      resolve: async () => resolved,
    });
    expect(result).toBe(resolved);
  });
});

describe("wrapEndpoint", () => {
  it("runs an effect-returning endpoint", async () => {
    const get = wrapEndpoint(() => Effect.succeed(new Response("hello")));
    const result = await get(mockEvent());
    expect(await result.text()).toBe("hello");
  });

  it("passes plain endpoint through", async () => {
    const get = wrapEndpoint(() => new Response("plain"));
    const result = await get(mockEvent());
    expect(await result.text()).toBe("plain");
  });
});

describe("runtime module support", () => {
  class Greeter extends Context.Service<Greeter, { greet: (name: string) => string }>()(
    "auto-test/Greeter",
  ) {}

  const greeterLayer = Layer.succeed(Greeter, { greet: (name) => `hello ${name}` });

  it("wrapServerLoad resolves services from a server runtime module", async () => {
    const runtimeMod = { runtime: makeServerRuntime(greeterLayer) };
    const fn = wrapServerLoad(
      () => Effect.map(Greeter, (g) => ({ message: g.greet("server") })),
      runtimeMod,
    );
    const result = await fn(mockEvent());
    expect(result).toEqual({ message: "hello server" });
  });

  it("wrapServerLoad accepts the runtime as a default export", async () => {
    const runtimeMod = { default: makeServerRuntime(greeterLayer) };
    const fn = wrapServerLoad(
      () => Effect.map(Greeter, (g) => ({ message: g.greet("default") })),
      runtimeMod,
    );
    const result = await fn(mockEvent());
    expect(result).toEqual({ message: "hello default" });
  });

  it("wrapLoad resolves services from a universal runtime module", async () => {
    const runtimeMod = { runtime: makeUniversalRuntime(greeterLayer) };
    const fn = wrapLoad(
      () => Effect.map(Greeter, (g) => ({ message: g.greet("universal") })),
      runtimeMod,
    );
    const result = await fn(mockLoadEvent());
    expect(result).toEqual({ message: "hello universal" });
  });

  it("wrapActions passes the runtime module to each action", async () => {
    const runtimeMod = { runtime: makeServerRuntime(greeterLayer) };
    const actions = wrapActions(
      { create: () => Effect.map(Greeter, (g) => ({ created: g.greet("action") })) },
      runtimeMod,
    );
    const result = await actions.create(mockEvent());
    expect(result).toEqual({ created: "hello action" });
  });

  it("wrapInit runs effects on the app runtime (services, no request)", async () => {
    const runtimeMod = { runtime: makeServerRuntime(greeterLayer) };
    let initialised = "";
    const init = wrapInit(
      () =>
        Effect.map(Greeter, (g) => {
          initialised = g.greet("init");
        }),
      runtimeMod,
    );
    await init();
    expect(initialised).toBe("hello init");
  });
});
