import { describe, expect, it } from "vite-plus/test";
import { error, isHttpError, isRedirect, redirect } from "@sveltejs/kit";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { makeRuntimeAdapter, RequestRuntime } from "../src/request-runtime.js";

const mockEvent = (url = "http://localhost/") =>
  ({
    request: new Request(url),
    fetch,
    cookies: {} as any,
    locals: {},
    params: {},
    platform: undefined,
    route: { id: null },
    setHeaders: () => undefined,
    url: new URL(url),
    isDataRequest: false,
    isSubRequest: false,
  }) as any;

class Greeter extends Context.Service<Greeter, { greet: (name: string) => string }>()(
  "test/Greeter",
) {}

const greeterLayer = Layer.succeed(Greeter, { greet: (name) => `hello ${name}` });

// A tiny tagged-error catalogue, like a consumer's domain errors.
class NotFound {
  readonly _tag = "NotFound";
}
class ValidationFailure {
  readonly _tag = "ValidationFailure";
  constructor(readonly field: string) {}
}

describe("RequestRuntime constructors", () => {
  it("fromManagedRuntime runs effects against the runtime's services", async () => {
    const rt = ManagedRuntime.make(greeterLayer);
    const { serverLoad } = makeRuntimeAdapter(RequestRuntime.fromManagedRuntime(rt));
    const load = serverLoad(() => Effect.map(Greeter, (g) => ({ message: g.greet("a") })));
    expect(await load(mockEvent())).toEqual({ message: "hello a" });
    await rt.dispose();
  });

  it("fromLayer builds the layer once and shares it across requests", async () => {
    let builds = 0;
    const counting = Layer.effect(
      Greeter,
      Effect.sync(() => {
        builds++;
        return { greet: (n: string) => n };
      }),
    );
    const { serverLoad } = makeRuntimeAdapter(RequestRuntime.fromLayer(counting));
    const load = serverLoad(() => Effect.map(Greeter, (g) => ({ message: g.greet("x") })));
    await load(mockEvent());
    await load(mockEvent());
    expect(builds).toBe(1);
  });

  it("fromLocals adopts a runtime from the event, resolved at call time", async () => {
    const rtA = ManagedRuntime.make(Layer.succeed(Greeter, { greet: () => "A" }));
    const rtB = ManagedRuntime.make(Layer.succeed(Greeter, { greet: () => "B" }));
    const { serverLoad } = makeRuntimeAdapter(
      RequestRuntime.fromLocals((event) => (event.locals as any).runtime),
    );
    const load = serverLoad(() => Effect.map(Greeter, (g) => ({ who: g.greet("") })));

    const event = mockEvent();
    (event.locals as any).runtime = rtA;
    expect(await load(event)).toEqual({ who: "A" });

    // The runtime is rebuilt mid-request; the next call picks it up.
    (event.locals as any).runtime = rtB;
    expect(await load(event)).toEqual({ who: "B" });

    await rtA.dispose();
    await rtB.dispose();
  });

  it("fromLocals accepts a built service Context", async () => {
    const context = Context.make(Greeter, { greet: (n) => `ctx ${n}` });
    const { serverLoad } = makeRuntimeAdapter(RequestRuntime.fromLocals(() => context));
    const load = serverLoad(() => Effect.map(Greeter, (g) => ({ message: g.greet("z") })));
    expect(await load(mockEvent())).toEqual({ message: "ctx z" });
  });

  it("fromLayerPerRequest builds and disposes a runtime per handler invocation", async () => {
    const events: string[] = [];
    const layer = (_event: any) =>
      Layer.effect(
        Greeter,
        Effect.acquireRelease(
          Effect.sync(() => {
            events.push("build");
            return { greet: (n: string) => n };
          }),
          () => Effect.sync(() => events.push("dispose")),
        ),
      );
    const { serverLoad } = makeRuntimeAdapter(RequestRuntime.fromLayerPerRequest(layer));
    const load = serverLoad(() => Effect.map(Greeter, (g) => ({ message: g.greet("x") })));
    await load(mockEvent());
    expect(events).toEqual(["build", "dispose"]);
  });

  it("fromLayerPerRequest defers disposal via afterResponse", async () => {
    const events: string[] = [];
    const deferred: Array<() => Promise<void>> = [];
    const layer = () =>
      Layer.effect(
        Greeter,
        Effect.acquireRelease(Effect.succeed({ greet: (n: string) => n }), () =>
          Effect.sync(() => events.push("dispose")),
        ),
      );
    const { serverLoad } = makeRuntimeAdapter(
      RequestRuntime.fromLayerPerRequest(layer, {
        afterResponse: (_event, dispose) => deferred.push(dispose),
      }),
    );
    const load = serverLoad(() => Effect.map(Greeter, (g) => ({ message: g.greet("x") })));
    await load(mockEvent());

    // Disposal has not run yet; it was deferred.
    expect(events).toEqual([]);
    expect(deferred).toHaveLength(1);
    await deferred[0]!();
    expect(events).toEqual(["dispose"]);
  });
});

describe("makeRuntimeAdapter wrappers", () => {
  it("supports action, actions, and endpoint", async () => {
    const provider = RequestRuntime.fromLayer(greeterLayer);
    const { action, actions, endpoint } = makeRuntimeAdapter(provider);

    const single = action(() => Effect.map(Greeter, (g) => ({ ok: g.greet("act") })));
    expect(await single(mockEvent())).toEqual({ ok: "hello act" });

    const map = actions({
      create: () => Effect.map(Greeter, (g) => ({ created: g.greet("c") })),
    });
    expect(await map.create!(mockEvent())).toEqual({ created: "hello c" });

    const get = endpoint(() => Effect.map(Greeter, (g) => new Response(g.greet("e"))));
    expect(await (await get(mockEvent())).text()).toBe("hello e");
  });

  it("disposeAfterResponse runs once the handler settles", async () => {
    const disposed: string[] = [];
    const provider = {
      ...RequestRuntime.fromLayer(greeterLayer),
      disposeAfterResponse: () => disposed.push("x"),
    };
    const { serverLoad } = makeRuntimeAdapter(provider);
    const load = serverLoad(() => Effect.succeed({ ok: true }));
    await load(mockEvent());
    expect(disposed).toEqual(["x"]);
  });
});

describe("boundary error translation", () => {
  it("passes SvelteKit redirect()/error() through by default", async () => {
    const { serverLoad } = makeRuntimeAdapter(RequestRuntime.fromLayer(Layer.empty));
    const redirecting = serverLoad(() =>
      Effect.sync((): void => {
        redirect(302, "/elsewhere");
      }),
    );
    await expect(redirecting(mockEvent())).rejects.toSatisfy((e: unknown) => isRedirect(e));

    const erroring = serverLoad(() =>
      Effect.sync((): void => {
        error(404, "nope");
      }),
    );
    await expect(erroring(mockEvent())).rejects.toSatisfy((e: unknown) => isHttpError(e));
  });

  it("maps a domain error to SvelteKit control flow via translateError", async () => {
    const translateError = (cause: Cause.Cause<unknown>): never => {
      const failure = Cause.squash(cause);
      if (failure instanceof NotFound) error(404, "not found");
      if (failure instanceof ValidationFailure) error(400, `invalid:${failure.field}`);
      throw new Error("unexpected");
    };
    const { serverLoad } = makeRuntimeAdapter(RequestRuntime.fromLayer(Layer.empty), {
      translateError,
    });

    const notFound = serverLoad(() => Effect.fail(new NotFound()));
    await expect(notFound(mockEvent())).rejects.toSatisfy(
      (e: unknown) => isHttpError(e) && (e as any).status === 404,
    );

    const invalid = serverLoad(() => Effect.fail(new ValidationFailure("email")));
    await expect(invalid(mockEvent())).rejects.toSatisfy(
      (e: unknown) => isHttpError(e) && (e as any).body.message === "invalid:email",
    );
  });

  it("endpoint returns a 500 JSON body by default and exposes details on request", async () => {
    const { endpoint } = makeRuntimeAdapter(RequestRuntime.fromLayer(Layer.empty));

    const quiet = endpoint(() => Effect.fail("boom"));
    const quietResponse = await quiet(mockEvent());
    expect(quietResponse.status).toBe(500);
    expect(await quietResponse.json()).toEqual({ error: "Internal server error" });

    const loud = endpoint(() => Effect.fail("boom"), { exposeErrors: true });
    const loudResponse = await loud(mockEvent());
    expect(loudResponse.status).toBe(500);
    expect((await loudResponse.json()).error).toContain("boom");
  });

  it("endpoint defers its whole failure path to a configured translator", async () => {
    const { endpoint } = makeRuntimeAdapter(RequestRuntime.fromLayer(Layer.empty), {
      translateError: () => error(403, "forbidden"),
    });
    const handler = endpoint(() => Effect.fail(new NotFound()));
    await expect(handler(mockEvent())).rejects.toSatisfy(
      (e: unknown) => isHttpError(e) && (e as any).status === 403,
    );
  });
});
