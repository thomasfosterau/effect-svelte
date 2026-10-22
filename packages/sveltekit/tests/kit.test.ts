import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { error, isHttpError, isRedirect, redirect } from "@sveltejs/kit";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { KitActionFailure, KitError, KitRedirect, SvelteKit } from "../src/kit.js";
import { makeRuntimeAdapter, RequestRuntime } from "../src/request-runtime.js";

// ─── Tagged error classes ────────────────────────────────────────────────────

describe("KitRedirect", () => {
  it("has the KitRedirect _tag", () => {
    const e = new KitRedirect(302, "/home");
    expect(e._tag).toBe("KitRedirect");
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(302);
    expect(e.location).toBe("/home");
  });
});

describe("KitError", () => {
  it("has the KitError _tag", () => {
    const e = new KitError(404, "Not found");
    expect(e._tag).toBe("KitError");
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(404);
    expect(e.body).toBe("Not found");
  });

  it("body is optional", () => {
    const e = new KitError(500);
    expect(e.body).toBeUndefined();
  });
});

describe("KitActionFailure", () => {
  it("has the KitActionFailure _tag", () => {
    const e = new KitActionFailure(422, { email: "taken" });
    expect(e._tag).toBe("KitActionFailure");
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(422);
    expect(e.data).toEqual({ email: "taken" });
  });
});

// ─── SvelteKit.redirect / error / fail helpers ───────────────────────────────

describe("SvelteKit helper effects", () => {
  it("redirect produces a KitRedirect failure", async () => {
    const exit = await Effect.runPromise(Effect.exit(SvelteKit.redirect(302, "/home")));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const squashed = Cause.squash(exit.cause);
      expect(squashed).toBeInstanceOf(KitRedirect);
      expect((squashed as KitRedirect).status).toBe(302);
      expect((squashed as KitRedirect).location).toBe("/home");
    }
  });

  it("error produces a KitError failure", async () => {
    const exit = await Effect.runPromise(Effect.exit(SvelteKit.error(404, "Not found")));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const squashed = Cause.squash(exit.cause);
      expect(squashed).toBeInstanceOf(KitError);
      expect((squashed as KitError).status).toBe(404);
      expect((squashed as KitError).body).toBe("Not found");
    }
  });

  it("fail produces a KitActionFailure", async () => {
    const exit = await Effect.runPromise(Effect.exit(SvelteKit.fail(422, { email: "taken" })));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const squashed = Cause.squash(exit.cause);
      expect(squashed).toBeInstanceOf(KitActionFailure);
      expect((squashed as KitActionFailure).status).toBe(422);
      expect((squashed as KitActionFailure<{ email: string }>).data).toEqual({ email: "taken" });
    }
  });

  it("redirect is usable with Effect.catchTag", async () => {
    const redirectStatus = await Effect.runPromise(
      SvelteKit.redirect(303, "/login").pipe(
        Effect.catchTag("KitRedirect", (e) => Effect.succeed(e.status)),
      ),
    );
    expect(redirectStatus).toBe(303);
  });
});

// ─── SvelteKit.translate ─────────────────────────────────────────────────────

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

describe("SvelteKit.translate", () => {
  it("translates KitRedirect → redirect() throw", async () => {
    const { serverLoad } = makeRuntimeAdapter(RequestRuntime.fromLayer(Layer.empty), {
      translateError: SvelteKit.translate,
    });
    const load = serverLoad(() => SvelteKit.redirect(302, "/elsewhere"));
    await expect(load(mockEvent())).rejects.toSatisfy(
      (e: unknown) => isRedirect(e) && (e as any).location === "/elsewhere",
    );
  });

  it("translates KitError → error() throw", async () => {
    const { serverLoad } = makeRuntimeAdapter(RequestRuntime.fromLayer(Layer.empty), {
      translateError: SvelteKit.translate,
    });
    const load = serverLoad(() => SvelteKit.error(403, "Forbidden"));
    await expect(load(mockEvent())).rejects.toSatisfy(
      (e: unknown) => isHttpError(e) && (e as any).status === 403,
    );
  });

  it("translates KitActionFailure → fail() return (action path)", async () => {
    const { action } = makeRuntimeAdapter(RequestRuntime.fromLayer(Layer.empty), {
      translateError: SvelteKit.translate,
    });
    const act = action(() => SvelteKit.fail(422, { email: "taken" }));
    const result = await act(mockEvent());
    // fail() returns an ActionFailure with status and data
    expect((result as any).status).toBe(422);
    expect((result as any).data).toEqual({ email: "taken" });
  });

  it("translates plain SvelteKit redirect/error through unchanged", async () => {
    const { serverLoad } = makeRuntimeAdapter(RequestRuntime.fromLayer(Layer.empty), {
      translateError: SvelteKit.translate,
    });

    const redirecting = serverLoad(() =>
      Effect.sync(() => {
        redirect(302, "/other");
      }),
    );
    await expect(redirecting(mockEvent())).rejects.toSatisfy(isRedirect);

    const erroring = serverLoad(() =>
      Effect.sync(() => {
        error(404, "nope");
      }),
    );
    await expect(erroring(mockEvent())).rejects.toSatisfy(isHttpError);
  });

  it("wraps unrecognised errors in EffectCauseError", async () => {
    const { serverLoad } = makeRuntimeAdapter(RequestRuntime.fromLayer(Layer.empty), {
      translateError: SvelteKit.translate,
    });
    const load = serverLoad(() => Effect.fail("unexpected"));
    await expect(load(mockEvent())).rejects.toMatchObject({ name: "EffectCauseError" });
  });
});

// ─── SvelteKit.translate is the default ──────────────────────────────────────

describe("SvelteKit.translate is the default translateError", () => {
  it("makeRuntimeAdapter defaults to SvelteKit.translate", async () => {
    const { serverLoad } = makeRuntimeAdapter(RequestRuntime.fromLayer(Layer.empty));
    const load = serverLoad(() => SvelteKit.redirect(302, "/default"));
    await expect(load(mockEvent())).rejects.toSatisfy(
      (e: unknown) => isRedirect(e) && (e as any).location === "/default",
    );
  });

  it("makeRuntimeAdapter default translates KitError", async () => {
    const { serverLoad } = makeRuntimeAdapter(RequestRuntime.fromLayer(Layer.empty));
    const load = serverLoad(() => SvelteKit.error(401, "Unauthorized"));
    await expect(load(mockEvent())).rejects.toSatisfy(
      (e: unknown) => isHttpError(e) && (e as any).status === 401,
    );
  });
});

// ─── SvelteKit.makeTranslator ─────────────────────────────────────────────────

class NotFound {
  readonly _tag = "NotFound" as const;
}
class Forbidden {
  readonly _tag = "Forbidden" as const;
  constructor(readonly reason: string) {}
}

describe("SvelteKit.makeTranslator", () => {
  const translateError = SvelteKit.makeTranslator([
    (e) => {
      if (e instanceof NotFound) error(404, "not found");
    },
    (e) => {
      if (e instanceof Forbidden) error(403, (e as Forbidden).reason);
    },
  ]);

  it("consumer case runs before the Kit base cases", async () => {
    const { serverLoad } = makeRuntimeAdapter(RequestRuntime.fromLayer(Layer.empty), {
      translateError,
    });

    const notFound = serverLoad(() => Effect.fail(new NotFound()));
    await expect(notFound(mockEvent())).rejects.toSatisfy(
      (e: unknown) => isHttpError(e) && (e as any).status === 404,
    );

    const forbidden = serverLoad(() => Effect.fail(new Forbidden("access denied")));
    await expect(forbidden(mockEvent())).rejects.toSatisfy(
      (e: unknown) => isHttpError(e) && (e as any).body.message === "access denied",
    );
  });

  it("Kit base cases still work when no consumer case matches", async () => {
    const { serverLoad } = makeRuntimeAdapter(RequestRuntime.fromLayer(Layer.empty), {
      translateError,
    });
    const load = serverLoad(() => SvelteKit.redirect(302, "/kit-redirect"));
    await expect(load(mockEvent())).rejects.toSatisfy(
      (e: unknown) => isRedirect(e) && (e as any).location === "/kit-redirect",
    );
  });

  it("unrecognised errors still produce EffectCauseError", async () => {
    const { serverLoad } = makeRuntimeAdapter(RequestRuntime.fromLayer(Layer.empty), {
      translateError,
    });
    const load = serverLoad(() => Effect.fail("totally unknown"));
    await expect(load(mockEvent())).rejects.toMatchObject({ name: "EffectCauseError" });
  });

  it("multiple cases are tried in order", async () => {
    const order: string[] = [];
    const translator = SvelteKit.makeTranslator([
      (e) => {
        order.push("first");
        if (e instanceof NotFound) error(404, "not found");
      },
      (e) => {
        order.push("second");
        if (e instanceof Forbidden) error(403, "forbidden");
      },
    ]);

    const cause = Cause.fail(new NotFound());
    try {
      translator(cause);
    } catch {}
    expect(order).toEqual(["first"]);
  });
});

// ─── endpoint integration ────────────────────────────────────────────────────

describe("endpoint with Kit errors", () => {
  it("KitRedirect in endpoint throws for SvelteKit to handle", async () => {
    const { endpoint } = makeRuntimeAdapter(RequestRuntime.fromLayer(Layer.empty));
    const handler = endpoint(() => SvelteKit.redirect(302, "/redirected"));
    await expect(handler(mockEvent())).rejects.toSatisfy(isRedirect);
  });

  it("KitError in endpoint throws for SvelteKit to handle", async () => {
    const { endpoint } = makeRuntimeAdapter(RequestRuntime.fromLayer(Layer.empty));
    const handler = endpoint(() => SvelteKit.error(404, "not found"));
    await expect(handler(mockEvent())).rejects.toSatisfy(isHttpError);
  });

  it("unrecognised endpoint error still returns 500 Response", async () => {
    const { endpoint } = makeRuntimeAdapter(RequestRuntime.fromLayer(Layer.empty));
    const handler = endpoint(() => Effect.fail("boom"));
    const response = await handler(mockEvent());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
  });

  it("exposeErrors still works on unrecognised endpoint error", async () => {
    const { endpoint } = makeRuntimeAdapter(RequestRuntime.fromLayer(Layer.empty));
    const handler = endpoint(() => Effect.fail("boom"), { exposeErrors: true });
    const response = await handler(mockEvent());
    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain("boom");
  });
});

// ─── SvelteKit.translate → error(status, message, properties) ────────────────

describe("SvelteKit.translate KitError bodies", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const translated = (failure: KitError): { status: number; body: Record<string, unknown> } => {
    try {
      SvelteKit.translate(Cause.fail(failure));
    } catch (thrown) {
      expect(isHttpError(thrown)).toBe(true);
      return thrown as { status: number; body: Record<string, unknown> };
    }
    throw new Error("SvelteKit.translate did not throw");
  };

  it("passes a string body as the message", () => {
    expect(translated(new KitError(404, "Not found")).body).toEqual({
      status: 404,
      message: "Not found",
    });
  });

  it("uses Kit's default message when there is no body", () => {
    expect(translated(new KitError(500)).body).toEqual({ status: 500, message: "Error: 500" });
  });

  it("splits an object body into the message and the extra App.Error properties", () => {
    const thrown = translated(new KitError(409, { message: "Taken", code: "EMAIL_TAKEN" }));
    expect(thrown.status).toBe(409);
    expect(thrown.body).toEqual({ status: 409, message: "Taken", code: "EMAIL_TAKEN" });
  });

  it("keeps the KitError status over a status field in the body, and defaults the message", () => {
    const thrown = translated(new KitError(422, { status: 400, code: "INVALID" }));
    expect(thrown.status).toBe(422);
    expect(thrown.body).toEqual({ status: 422, message: "Error: 422", code: "INVALID" });
  });

  it("drops a non-string message field in favour of Kit's default message", () => {
    expect(translated(new KitError(500, { message: 42, code: "X" })).body).toEqual({
      status: 500,
      message: "Error: 500",
      code: "X",
    });
  });

  it("never reaches the deprecated error(status, body) overload", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    translated(new KitError(409, { message: "Taken", code: "EMAIL_TAKEN" }));
    expect(warn).not.toHaveBeenCalled();
  });
});
