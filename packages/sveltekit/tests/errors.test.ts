/**
 * `Errors.toSvelteKit` — the catalogue-driven `translateError`. Ported from the
 * website application's `translate` suite (its hand-written `toSvelteKit`
 * switch is the behavioural spec): every tag in the catalogue becomes one
 * SvelteKit `error()` / `redirect()` throw, and anything outside it falls
 * through untouched.
 */
import { error, isHttpError, isRedirect } from "@sveltejs/kit";
import { Cause, Effect, Layer, Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vite-plus/test";
import * as Errors from "../src/errors.js";
import { EffectCauseError } from "../src/internal/error.js";
import { KitError } from "../src/kit.js";
import { makeRuntimeAdapter, RequestRuntime } from "../src/request-runtime.js";

class NotFound extends Schema.TaggedErrorClass<NotFound>()("NotFound", {
  resource: Schema.String,
  id: Schema.String,
}) {}
class Unauthorized extends Schema.TaggedErrorClass<Unauthorized>()("Unauthorized", {
  message: Schema.optional(Schema.String),
}) {}
class Forbidden extends Schema.TaggedErrorClass<Forbidden>()("Forbidden", {
  message: Schema.optional(Schema.String),
}) {}
class Redirect extends Schema.TaggedErrorClass<Redirect>()("Redirect", {
  to: Schema.String,
  status: Schema.Number,
}) {}
class HttpError extends Schema.TaggedErrorClass<HttpError>()("HttpError", {
  status: Schema.Number,
  message: Schema.String,
}) {}
/** Stands in for effect-jsonapi's `JsonapiError`: a status plus a document. */
class JsonapiError extends Schema.TaggedErrorClass<JsonapiError>()("JsonapiError", {
  status: Schema.Number,
  errors: Schema.Array(Schema.Struct({ status: Schema.String, detail: Schema.String })),
}) {
  toDocument() {
    return { jsonapi: { version: "1.1" }, errors: this.errors };
  }
}

type AppError = NotFound | Unauthorized | Forbidden | Redirect | HttpError | JsonapiError;

const translateError = Errors.toSvelteKit<AppError>({
  NotFound: { status: 404, message: (e) => `${e.resource} ${e.id} not found` },
  Unauthorized: 401,
  Forbidden: 403,
  Redirect: "redirect",
  HttpError: "status",
  JsonapiError: (e) => error(e.status, JSON.stringify(e.toDocument())),
});

type Thrown = { status?: number; location?: string; body?: { message?: string } };

const captureThrow = (cause: Cause.Cause<unknown>): Thrown => {
  try {
    translateError(cause);
  } catch (thrown) {
    return thrown as Thrown;
  }
  throw new Error("translateError did not throw");
};

describe("Errors.toSvelteKit", () => {
  it("maps NotFound to a 404 with the catalogue's message", () => {
    const thrown = captureThrow(Cause.fail(new NotFound({ resource: "notes", id: "abc" })));
    expect(isHttpError(thrown)).toBe(true);
    expect(thrown.status).toBe(404);
    expect(thrown.body?.message).toBe("notes abc not found");
  });

  it("maps Unauthorized to a 401 carrying the error's own message", () => {
    const thrown = captureThrow(Cause.fail(new Unauthorized({ message: "Sign in" })));
    expect(thrown.status).toBe(401);
    expect(thrown.body?.message).toBe("Sign in");
  });

  it("falls back to the tag when the error has no message", () => {
    const thrown = captureThrow(Cause.fail(new Forbidden({})));
    expect(thrown.status).toBe(403);
    expect(thrown.body?.message).toBe("Forbidden");
  });

  it("maps Redirect to a SvelteKit redirect with the supplied status and location", () => {
    const thrown = captureThrow(Cause.fail(new Redirect({ to: "/notes/abc", status: 303 })));
    expect(isRedirect(thrown)).toBe(true);
    expect(thrown.status).toBe(303);
    expect(thrown.location).toBe("/notes/abc");
  });

  it("defaults a non-3xx redirect status to 303", () => {
    const thrown = captureThrow(Cause.fail(new Redirect({ to: "/", status: 200 })));
    expect(thrown.status).toBe(303);
  });

  it("maps a 'status' entry to error(e.status, e.message)", () => {
    const thrown = captureThrow(Cause.fail(new HttpError({ status: 409, message: "Conflict" })));
    expect(thrown.status).toBe(409);
    expect(thrown.body?.message).toBe("Conflict");
  });

  it("turns an out-of-range 'status' into a 500", () => {
    const thrown = captureThrow(Cause.fail(new HttpError({ status: 200, message: "odd" })));
    expect(thrown.status).toBe(500);
  });

  it("hands a function entry full control (a JSON:API document body)", () => {
    const thrown = captureThrow(
      Cause.fail(
        new JsonapiError({ status: 422, errors: [{ status: "422", detail: "expected string" }] }),
      ),
    );
    expect(thrown.status).toBe(422);
    const document = JSON.parse(thrown.body?.message ?? "{}");
    expect(document.errors).toHaveLength(1);
    expect(document.jsonapi.version).toBe("1.1");
  });

  it("matches a tagged error that surfaced as a defect", () => {
    const thrown = captureThrow(Cause.die(new NotFound({ resource: "notes", id: "x" })));
    expect(thrown.status).toBe(404);
  });

  it("wraps an unknown failure in an EffectCauseError by default (SvelteKit.translate)", () => {
    const defect = new Error("boom");
    expect(() => translateError(Cause.die(defect))).toThrow(EffectCauseError);
  });

  it("still passes the Kit control-flow errors through by default", () => {
    const thrown = captureThrow(Cause.fail(new KitError(418, "teapot")));
    expect(thrown.status).toBe(418);
  });

  it("rethrows unknown failures unchanged with the rethrowSquashed fallback", () => {
    const defect = new Error("boom");
    const rethrowing = Errors.toSvelteKit<AppError>(
      { NotFound: 404 },
      { fallback: Errors.rethrowSquashed },
    );
    expect(() => rethrowing(Cause.die(defect))).toThrow(defect);
  });

  it("ignores inherited keys and non-tagged values", () => {
    const untyped = Errors.toSvelteKit({ NotFound: 404 });
    expect(() => untyped(Cause.fail({ _tag: "toString" }))).toThrow(EffectCauseError);
    expect(() => untyped(Cause.fail("plain string"))).toThrow(EffectCauseError);
  });

  it("checks catalogue keys and entry callbacks against the error union", () => {
    expectTypeOf(Errors.toSvelteKit<AppError>)
      .parameter(0)
      .toHaveProperty("NotFound");
    // @ts-expect-error: `Missing` is not a tag of AppError
    Errors.toSvelteKit<AppError>({ Missing: 404 });
    // @ts-expect-error: NotFound has no `to` field
    Errors.toSvelteKit<AppError>({ NotFound: { status: 404, message: (e) => e.to } });
  });
});

describe("Errors.toSvelteKit through makeRuntimeAdapter", () => {
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

  it("makes the app's kit.ts a one-liner", async () => {
    const { serverLoad } = makeRuntimeAdapter(RequestRuntime.fromLayer(Layer.empty), {
      translateError,
    });
    const load = serverLoad(() => Effect.fail(new NotFound({ resource: "notes", id: "abc" })));

    await expect(load(mockEvent())).rejects.toMatchObject({
      status: 404,
      body: { message: "notes abc not found" },
    });
  });
});
