import { describe, expect, it } from "vite-plus/test";
import { error, isHttpError, isRedirect, redirect } from "@sveltejs/kit";
import { Context, Effect, Layer } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import { makeServerRuntime, makeUniversalRuntime } from "../src/kit/app-runtime.js";
import { SvelteKitRequestEvent } from "../src/kit/runtime.js";

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

class Greeter extends Context.Service<Greeter, { greet: (name: string) => string }>()(
  "test/Greeter",
) {}

const greeterLayer = Layer.succeed(Greeter, { greet: (name) => `hello ${name}` });

describe("makeServerRuntime", () => {
  it("provides app layer services to serverLoad", async () => {
    const runtime = makeServerRuntime(greeterLayer);
    const load = runtime.serverLoad(() =>
      Effect.gen(function* () {
        const greeter = yield* Greeter;
        return { message: greeter.greet("world") };
      }),
    );
    const result = await load(mockEvent());
    expect(result).toEqual({ message: "hello world" });
  });

  it("provides the request event and HttpClient alongside app services", async () => {
    const runtime = makeServerRuntime(greeterLayer);
    const load = runtime.serverLoad(() =>
      Effect.gen(function* () {
        const greeter = yield* Greeter;
        const event = yield* SvelteKitRequestEvent;
        const client = yield* HttpClient.HttpClient;
        return {
          message: greeter.greet("world"),
          url: event.url.toString(),
          hasClient: client !== undefined,
        };
      }),
    );
    const result = await load(mockEvent());
    expect(result).toEqual({
      message: "hello world",
      url: "http://localhost/",
      hasClient: true,
    });
  });

  it("builds the application layer only once across requests", async () => {
    let builds = 0;
    const countingLayer = Layer.effect(
      Greeter,
      Effect.sync(() => {
        builds++;
        return { greet: (name: string) => `hi ${name}` };
      }),
    );

    const runtime = makeServerRuntime(countingLayer);
    const load = runtime.serverLoad(() => Effect.map(Greeter, (g) => ({ message: g.greet("x") })));

    await load(mockEvent());
    await load(mockEvent());
    await load(mockEvent());

    expect(builds).toBe(1);
  });

  it("supports actions, endpoint, and handle wrappers", async () => {
    const runtime = makeServerRuntime(greeterLayer);

    const actions = runtime.actions({
      create: () => Effect.map(Greeter, (g) => ({ created: g.greet("create") })),
    });
    expect(await actions.create!(mockEvent())).toEqual({ created: "hello create" });

    const get = runtime.endpoint(() =>
      Effect.map(Greeter, (g) => new Response(g.greet("endpoint"))),
    );
    expect(await (await get(mockEvent())).text()).toBe("hello endpoint");

    const resolved = new Response("handled");
    const handle = runtime.handle(({ event, resolve }) =>
      Effect.flatMap(Greeter, () => Effect.promise(async () => resolve(event))),
    );
    const response = await handle({ event: mockEvent(), resolve: async () => resolved } as any);
    expect(response).toBe(resolved);
  });

  it("passes redirect() through to SvelteKit", async () => {
    const runtime = makeServerRuntime(greeterLayer);
    const load = runtime.serverLoad(() =>
      Effect.sync((): void => {
        redirect(302, "/elsewhere");
      }),
    );
    try {
      await load(mockEvent());
      throw new Error("expected a redirect to be thrown");
    } catch (thrown) {
      expect(isRedirect(thrown)).toBe(true);
      expect((thrown as { location: string }).location).toBe("/elsewhere");
    }
  });

  it("passes error() through to SvelteKit", async () => {
    const runtime = makeServerRuntime(greeterLayer);
    const load = runtime.serverLoad(() =>
      Effect.sync((): void => {
        error(404, "Not found");
      }),
    );
    try {
      await load(mockEvent());
      throw new Error("expected an HttpError to be thrown");
    } catch (thrown) {
      expect(isHttpError(thrown)).toBe(true);
      expect((thrown as { status: number }).status).toBe(404);
    }
  });

  it("throws an EffectCauseError on failure", async () => {
    const runtime = makeServerRuntime(greeterLayer);
    const load = runtime.serverLoad(() => Effect.fail("boom"));
    await expect(load(mockEvent())).rejects.toThrow();
  });

  it("dispose() runs the layer's finalizers", async () => {
    let released = false;
    const scopedLayer = Layer.effect(
      Greeter,
      Effect.acquireRelease(Effect.succeed({ greet: (name: string) => name }), () =>
        Effect.sync(() => {
          released = true;
        }),
      ),
    );

    const runtime = makeServerRuntime(scopedLayer);
    await runtime.runPromise(
      mockEvent(),
      Effect.map(Greeter, (g) => g.greet("x")),
    );
    expect(released).toBe(false);

    await runtime.dispose();
    expect(released).toBe(true);
  });

  it("works without a layer (defaults to Layer.empty)", async () => {
    const runtime = makeServerRuntime();
    const load = runtime.serverLoad((event) => Effect.succeed({ url: event.url.toString() }));
    expect(await load(mockEvent())).toEqual({ url: "http://localhost/" });
  });
});

describe("makeUniversalRuntime", () => {
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

  it("provides app layer services on client-style events", async () => {
    const runtime = makeUniversalRuntime(greeterLayer);
    const load = runtime.load(() =>
      Effect.gen(function* () {
        const greeter = yield* Greeter;
        const client = yield* HttpClient.HttpClient;
        return { message: greeter.greet("client"), hasClient: client !== undefined };
      }),
    );
    const result = await load(clientEvent());
    expect(result).toEqual({ message: "hello client", hasClient: true });
  });

  it("provides app layer services on server-style events", async () => {
    const runtime = makeUniversalRuntime(greeterLayer);
    const load = runtime.load(() => Effect.map(Greeter, (g) => ({ message: g.greet("server") })));
    const result = await load(mockEvent());
    expect(result).toEqual({ message: "hello server" });
  });

  it("builds the application layer only once across loads", async () => {
    let builds = 0;
    const countingLayer = Layer.effect(
      Greeter,
      Effect.sync(() => {
        builds++;
        return { greet: (name: string) => name };
      }),
    );

    const runtime = makeUniversalRuntime(countingLayer);
    const load = runtime.load(() => Effect.map(Greeter, (g) => ({ message: g.greet("x") })));

    await load(clientEvent());
    await load(mockEvent());

    expect(builds).toBe(1);
  });
});
