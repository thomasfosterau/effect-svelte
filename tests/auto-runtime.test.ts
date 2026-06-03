import { describe, expect, it } from "vite-plus/test";
import { error, isHttpError, isRedirect, redirect } from "@sveltejs/kit";
import { Context, Effect, Layer } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import { makeServerRuntime, makeUniversalRuntime } from "../src/kit/app-runtime.js";
import {
  wrapAction,
  wrapActions,
  wrapEndpoint,
  wrapHandle,
  wrapInit,
  wrapLoad,
  wrapServerLoad,
} from "../src/kit/internal/auto.js";

const mockEvent = () =>
  ({
    request: new Request("http://localhost/"),
    fetch,
    cookies: {} as any,
    locals: {},
    params: {},
    platform: undefined,
    route: { id: null },
    setHeaders: () => undefined,
    url: new URL("http://localhost/"),
    isDataRequest: false,
    isSubRequest: false,
  }) as any;

describe("wrapServerLoad", () => {
  it("returns undefined when value is undefined", () => {
    expect(wrapServerLoad(undefined)).toBeUndefined();
  });

  it("runs an effect-returning function", async () => {
    const fn = wrapServerLoad((event: any) =>
      Effect.succeed({ ok: true, url: event.url.toString() }),
    );
    const result = await fn!(mockEvent());
    expect(result).toEqual({ ok: true, url: "http://localhost/" });
  });

  it("runs a bare Effect value", async () => {
    const fn = wrapServerLoad(Effect.succeed({ from: "effect" }));
    const result = await fn!(mockEvent());
    expect(result).toEqual({ from: "effect" });
  });

  it("passes through plain-function returns", async () => {
    const fn = wrapServerLoad(() => ({ plain: true }));
    const result = await fn!(mockEvent());
    expect(result).toEqual({ plain: true });
  });

  it("passes through promise-returning functions", async () => {
    const fn = wrapServerLoad(async () => ({ async: true }));
    const result = await fn!(mockEvent());
    expect(result).toEqual({ async: true });
  });

  it("throws an EffectCauseError on failure", async () => {
    const fn = wrapServerLoad(() => Effect.fail("boom"));
    await expect(fn!(mockEvent())).rejects.toThrow();
  });

  it("passes redirect() through to SvelteKit", async () => {
    const fn = wrapServerLoad(() =>
      Effect.sync((): void => {
        redirect(302, "/elsewhere");
      }),
    );
    try {
      await fn!(mockEvent());
      throw new Error("expected a redirect to be thrown");
    } catch (thrown) {
      expect(isRedirect(thrown)).toBe(true);
      expect((thrown as { location: string }).location).toBe("/elsewhere");
    }
  });

  it("passes error() through to SvelteKit", async () => {
    const fn = wrapServerLoad(() =>
      Effect.sync((): void => {
        error(404, "Not found");
      }),
    );
    try {
      await fn!(mockEvent());
      throw new Error("expected an HttpError to be thrown");
    } catch (thrown) {
      expect(isHttpError(thrown)).toBe(true);
      expect((thrown as { status: number }).status).toBe(404);
    }
  });

  it("provides HttpClient from the runtime", async () => {
    const fn = wrapServerLoad(() =>
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        return { hasClient: client !== undefined };
      }),
    );
    const result = await fn!(mockEvent());
    expect(result).toEqual({ hasClient: true });
  });
});

describe("wrapLoad (universal)", () => {
  const clientEvent = () =>
    ({
      url: new URL("http://localhost/"),
      params: {},
      route: { id: null },
      fetch,
      data: {},
      depends: () => undefined,
      parent: async () => ({}),
      setHeaders: () => undefined,
      untrack: <T>(fn: () => T) => fn(),
    }) as any;

  it("runs effects on client-style events (no request)", async () => {
    const fn = wrapLoad(() => Effect.succeed({ universal: true }));
    const result = await fn!(clientEvent());
    expect(result).toEqual({ universal: true });
  });

  it("provides HttpClient on client-style events via the event fetch", async () => {
    const fn = wrapLoad(() =>
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        return { hasClient: client !== undefined };
      }),
    );
    const result = await fn!(clientEvent());
    expect(result).toEqual({ hasClient: true });
  });
});

describe("wrapAction", () => {
  it("wraps a single action", async () => {
    const fn = wrapAction(() => Effect.succeed({ created: 1 }));
    const result = await fn!(mockEvent());
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
    const createResult = await actions!.create!(mockEvent());
    expect(createResult).toEqual({ created: true });
    const removeResult = await actions!.remove!(mockEvent());
    expect(removeResult).toEqual({ removed: true });
  });

  it("returns undefined for undefined input", () => {
    expect(wrapActions(undefined)).toBeUndefined();
  });
});

describe("wrapHandle", () => {
  it("runs an effect-returning hook", async () => {
    const handle = wrapHandle(({ event, resolve }: any) => Effect.promise(() => resolve(event)));
    const resolved = new Response("ok");
    const result = await handle!({
      event: mockEvent(),
      resolve: async () => resolved,
    } as any);
    expect(result).toBe(resolved);
  });

  it("passes plain handle through", async () => {
    const handle = wrapHandle(async ({ resolve, event }: any) => resolve(event));
    const resolved = new Response("plain");
    const result = await handle!({
      event: mockEvent(),
      resolve: async () => resolved,
    } as any);
    expect(result).toBe(resolved);
  });
});

describe("wrapEndpoint", () => {
  it("runs an effect-returning endpoint", async () => {
    const get = wrapEndpoint(() => Effect.succeed(new Response("hello")));
    const result = await get!(mockEvent());
    expect(await result.text()).toBe("hello");
  });

  it("passes plain endpoint through", async () => {
    const get = wrapEndpoint(() => new Response("plain"));
    const result = await get!(mockEvent());
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
    const result = await fn!(mockEvent());
    expect(result).toEqual({ message: "hello server" });
  });

  it("wrapServerLoad accepts the runtime as a default export", async () => {
    const runtimeMod = { default: makeServerRuntime(greeterLayer) };
    const fn = wrapServerLoad(
      () => Effect.map(Greeter, (g) => ({ message: g.greet("default") })),
      runtimeMod,
    );
    const result = await fn!(mockEvent());
    expect(result).toEqual({ message: "hello default" });
  });

  it("wrapLoad resolves services from a universal runtime module", async () => {
    const clientEvent = {
      url: new URL("http://localhost/"),
      params: {},
      route: { id: null },
      fetch,
      data: {},
      depends: () => undefined,
      parent: async () => ({}),
      setHeaders: () => undefined,
      untrack: <T>(fn: () => T) => fn(),
    } as any;

    const runtimeMod = { runtime: makeUniversalRuntime(greeterLayer) };
    const fn = wrapLoad(
      () => Effect.map(Greeter, (g) => ({ message: g.greet("universal") })),
      runtimeMod,
    );
    const result = await fn!(clientEvent);
    expect(result).toEqual({ message: "hello universal" });
  });

  it("wrapActions passes the runtime module to each action", async () => {
    const runtimeMod = { runtime: makeServerRuntime(greeterLayer) };
    const actions = wrapActions(
      { create: () => Effect.map(Greeter, (g) => ({ created: g.greet("action") })) },
      runtimeMod,
    );
    const result = await actions!.create!(mockEvent());
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
    await init!();
    expect(initialised).toBe("hello init");
  });
});
