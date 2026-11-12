import { assert, describe, expect, it } from "vite-plus/test";
import { error, isHttpError, isRedirect, redirect, type RequestEvent } from "@sveltejs/kit";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as HttpClient from "effect/http/HttpClient";
import { makeServerRuntime, makeUniversalRuntime } from "../src/app-runtime.js";
import { EffectCauseError } from "../src/internal/error.js";
import { SvelteKitRequestEvent } from "../src/runtime.js";
import { mockEvent, mockLoadEvent, toServerLoadEvent } from "./fixtures/request-event.js";
import { ForeignError } from "./fixtures/foreign-error.js";

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
    expect(await actions.create(mockEvent())).toEqual({ created: "hello create" });

    const get = runtime.endpoint(() =>
      Effect.map(Greeter, (g) => new Response(g.greet("endpoint"))),
    );
    expect(await (await get(mockEvent())).text()).toBe("hello endpoint");

    const resolved = new Response("handled");
    const handle = runtime.handle(({ event, resolve }) =>
      Effect.flatMap(Greeter, () => Effect.tryPromise(async () => resolve(event))),
    );
    const response = await handle({ event: mockEvent(), resolve: async () => resolved });
    expect(response).toBe(resolved);
  });

  it("supports handleFetch, handleError, and init hooks", async () => {
    const runtime = makeServerRuntime(greeterLayer);

    const handleFetch = runtime.handleFetch(({ request }) =>
      Effect.gen(function* () {
        const greeter = yield* Greeter;
        const requestEvent = yield* SvelteKitRequestEvent;
        const target = new URL(request.url).pathname;
        return new Response(`${greeter.greet("fetch")} ${requestEvent.url.pathname} ${target}`);
      }),
    );
    const fetchResponse = await handleFetch({
      event: mockEvent(),
      request: new Request("http://localhost/api"),
      fetch,
    });
    expect(await fetchResponse.text()).toBe("hello fetch / /api");

    const handleError = runtime.handleError(({ error: failure }) =>
      Effect.map(Greeter, (g) => ({
        message: g.greet(P.isError(failure) ? failure.message : String(failure)),
      })),
    );
    const appError = await handleError({
      kind: "unknown",
      error: new ForeignError("boom"),
      event: mockEvent(),
    });
    expect(appError).toEqual({ message: "hello boom" });

    let initialised = "";
    const init = runtime.init(
      Effect.map(Greeter, (g) => {
        initialised = g.greet("init");
      }),
    );
    await init();
    expect(initialised).toBe("hello init");
  });

  it("passes redirect() through to SvelteKit", async () => {
    const runtime = makeServerRuntime(greeterLayer);
    const load = runtime.serverLoad(() =>
      Effect.sync((): void => {
        redirect(302, "/elsewhere");
      }),
    );
    await expect(load(mockEvent())).rejects.toSatisfy(
      (thrown) => isRedirect(thrown) && thrown.location === "/elsewhere",
    );
  });

  it("passes error() through to SvelteKit", async () => {
    const runtime = makeServerRuntime(greeterLayer);
    const load = runtime.serverLoad(() =>
      Effect.sync((): void => {
        error(404, "Not found");
      }),
    );
    await expect(load(mockEvent())).rejects.toSatisfy(
      (thrown) => isHttpError(thrown) && thrown.status === 404,
    );
  });

  it("throws an EffectCauseError on failure", async () => {
    const runtime = makeServerRuntime(greeterLayer);
    const load = runtime.serverLoad(() => Effect.fail("boom"));
    await expect(load(mockEvent())).rejects.toThrow(EffectCauseError);
  });

  it("translateError maps a domain failure to SvelteKit control flow", async () => {
    class NotFound {
      readonly _tag = "NotFound";
    }
    const runtime = makeServerRuntime(greeterLayer, {
      translateError: (cause) => {
        if (Cause.squash(cause) instanceof NotFound) error(404, "missing");
        throw new ForeignError("unexpected");
      },
    });
    const load = runtime.serverLoad(() => Effect.fail(new NotFound()));
    await expect(load(mockEvent())).rejects.toSatisfy(
      (thrown) => isHttpError(thrown) && thrown.status === 404,
    );
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

describe("per-request runtime", () => {
  it("handle installs a per-request runtime that serverLoad shares", async () => {
    const runtime = makeServerRuntime(greeterLayer);
    const load = runtime.serverLoad(() =>
      Effect.gen(function* () {
        const greeter = yield* Greeter;
        const requestEvent = yield* SvelteKitRequestEvent;
        const client = yield* HttpClient.HttpClient;
        return {
          message: greeter.greet(requestEvent.url.pathname),
          hasClient: client !== undefined,
        };
      }),
    );
    const handle = runtime.handle(({ event, resolve }) =>
      Effect.tryPromise(async () => resolve(event)),
    );

    const event = mockEvent();
    expect(Option.isNone(runtime.requestRuntime(event))).toBe(true);

    let installedDuringResolve = false;
    const response = await handle({
      event,
      resolve: async (resolveEvent: RequestEvent) => {
        installedDuringResolve = Option.isSome(runtime.requestRuntime(resolveEvent));
        const data = await load(toServerLoadEvent(resolveEvent));
        return Response.json(data);
      },
    });

    expect(installedDuringResolve).toBe(true);
    expect(await response.json()).toEqual({ message: "hello /", hasClient: true });
  });

  it("requestRuntime runs effects with app and request services", async () => {
    const runtime = makeServerRuntime(greeterLayer);
    const handle = runtime.handle(({ event, resolve }) =>
      Effect.gen(function* () {
        const rt = runtime.requestRuntime(event);
        assert(Option.isSome(rt), "expected handle to install a per-request runtime");
        const greeting = yield* Effect.tryPromise(() =>
          rt.value.runPromise(
            Effect.map(Effect.zip(Greeter, SvelteKitRequestEvent), ([greeter, ev]) =>
              greeter.greet(ev.url.pathname),
            ),
          ),
        );
        return yield* Effect.tryPromise(async () => resolve(event)).pipe(
          Effect.as(new Response(greeting)),
        );
      }),
    );

    const response = await handle({
      event: mockEvent(),
      resolve: async () => new Response(),
    });
    expect(await response.text()).toBe("hello /");
  });

  it("a different runtime's wrappers fall back instead of using the wrong layer", async () => {
    const runtimeA = makeServerRuntime(greeterLayer);

    class Other extends Context.Service<Other, { who: () => string }>()("test/Other") {}
    const runtimeB = makeServerRuntime(Layer.succeed(Other, { who: () => "B" }));
    const loadB = runtimeB.serverLoad(() => Effect.map(Other, (o) => ({ who: o.who() })));

    const handleA = runtimeA.handle(({ event, resolve }) =>
      Effect.tryPromise(async () => resolve(event)),
    );

    const event = mockEvent();
    let resultB: unknown;
    let runtimeBInstalled = true;
    await handleA({
      event,
      resolve: async (resolveEvent: RequestEvent) => {
        // locals carries runtime A's per-request runtime, not B's.
        runtimeBInstalled = Option.isSome(runtimeB.requestRuntime(resolveEvent));
        resultB = await loadB(toServerLoadEvent(resolveEvent));
        return new Response();
      },
    });

    // B's load must run on B's layer (Other), not A's — so it falls back.
    expect(runtimeBInstalled).toBe(false);
    expect(resultB).toEqual({ who: "B" });
  });

  it.each([
    ["a string", "not an entry"],
    ["an owner that is not an object", { owner: "token", runtime: {} }],
    ["no runtime", { owner: {} }],
    ["a runtime that is not an object", { owner: {}, runtime: "runtime" }],
  ])(
    "requestRuntime is None when the locals key holds %s, and wrappers fall back",
    async (_label, foreign) => {
      const runtime = makeServerRuntime(greeterLayer);
      const load = runtime.serverLoad(() =>
        Effect.map(Greeter, (greeter) => ({ message: greeter.greet("x") })),
      );
      const locals: App.Locals = {};
      Object.defineProperty(locals, Symbol.for("@thomasfosterau/effect-sveltekit/requestRuntime"), {
        value: foreign,
        enumerable: true,
      });
      const event = mockEvent({ locals });

      expect(Option.isNone(runtime.requestRuntime(event))).toBe(true);
      // The wrappers build the request services themselves instead.
      expect(await load(event)).toEqual({ message: "hello x" });
    },
  );
});

describe("makeUniversalRuntime", () => {
  it("provides app layer services on client-style events", async () => {
    const runtime = makeUniversalRuntime(greeterLayer);
    const load = runtime.load(() =>
      Effect.gen(function* () {
        const greeter = yield* Greeter;
        const client = yield* HttpClient.HttpClient;
        return { message: greeter.greet("client"), hasClient: client !== undefined };
      }),
    );
    const result = await load(mockLoadEvent());
    expect(result).toEqual({ message: "hello client", hasClient: true });
  });

  it("provides app layer services on server-style events", async () => {
    const runtime = makeUniversalRuntime(greeterLayer);
    const load = runtime.load(() => Effect.map(Greeter, (g) => ({ message: g.greet("server") })));
    // A server-side universal load: the event carries the `request`.
    const result = await load({ ...mockEvent(), data: {} });
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

    await load(mockLoadEvent());
    await load({ ...mockEvent(), data: {} });

    expect(builds).toBe(1);
  });
});
