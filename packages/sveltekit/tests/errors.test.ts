/**
 * `Errors.toSvelteKit` — the catalogue-driven `translateError`. Every tag in the catalogue becomes one
 * SvelteKit `error()` / `redirect()` throw, and anything outside it falls
 * through untouched.
 */
import { error, isHttpError, isRedirect, type ServerLoadEvent } from "@sveltejs/kit";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { afterEach, assert, describe, expect, expectTypeOf, it, vi } from "vite-plus/test";
import * as Errors from "../src/errors.js";
import { EffectCauseError } from "../src/internal/error.js";
import { KitError } from "../src/kit.js";
import { makeRuntimeAdapter, RequestRuntime } from "../src/request-runtime.js";
import { TestRequestEvent } from "../src/testing.js";

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  resource: Schema.String,
  id: Schema.String,
}) {}
class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {
  message: Schema.optional(Schema.String),
}) {}
class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", {
  message: Schema.optional(Schema.String),
}) {}
class Redirect extends Schema.TaggedError<Redirect>()("Redirect", {
  to: Schema.String,
  status: Schema.Number,
}) {}
class HttpError extends Schema.TaggedError<HttpError>()("HttpError", {
  status: Schema.Number,
  message: Schema.String,
}) {}
/** Stands in for effect-jsonapi's `JsonapiError`: a status plus a document. */
/** A JSON:API error document, as {@link JsonapiError.toDocument} builds it. */
const JsonapiDocument = Schema.Struct({
  jsonapi: Schema.Struct({ version: Schema.String }),
  errors: Schema.Array(Schema.Struct({ status: Schema.String, detail: Schema.String })),
});
const JsonapiDocumentJson = Schema.fromJsonString(JsonapiDocument);

class JsonapiError extends Schema.TaggedError<JsonapiError>()("JsonapiError", {
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
  JsonapiError: (e) => error(e.status, Schema.encodeSync(JsonapiDocumentJson)(e.toDocument())),
});

/** What `translate` throws for `cause`; fails the test if it returns instead. */
const thrownBy = (translate: (cause: Cause.Cause<unknown>) => never, cause: Cause.Cause<unknown>) =>
  Effect.runSync(
    Effect.flip(
      Effect.try({
        try: () => translate(cause),
        catch: (thrown) => thrown,
      }),
    ),
  );

/** The SvelteKit `HttpError` that `translateError` throws for `cause`. */
const httpErrorFor = (cause: Cause.Cause<unknown>) => {
  const thrown = thrownBy(translateError, cause);
  assert(isHttpError(thrown), "expected translateError to throw a SvelteKit HttpError");
  return thrown;
};

/** The SvelteKit `Redirect` that `translateError` throws for `cause`. */
const redirectFor = (cause: Cause.Cause<unknown>) => {
  const thrown = thrownBy(translateError, cause);
  assert(isRedirect(thrown), "expected translateError to throw a SvelteKit Redirect");
  return thrown;
};

describe("Errors.toSvelteKit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps NotFound to a 404 with the catalogue's message", () => {
    const thrown = httpErrorFor(Cause.fail(new NotFound({ resource: "notes", id: "abc" })));
    expect(thrown.status).toBe(404);
    expect(thrown.body.message).toBe("notes abc not found");
  });

  it("maps Unauthorized to a 401 carrying the error's own message", () => {
    const thrown = httpErrorFor(Cause.fail(new Unauthorized({ message: "Sign in" })));
    expect(thrown.status).toBe(401);
    expect(thrown.body.message).toBe("Sign in");
  });

  it("falls back to the tag when the error has no message", () => {
    const thrown = httpErrorFor(Cause.fail(new Forbidden({})));
    expect(thrown.status).toBe(403);
    expect(thrown.body.message).toBe("Forbidden");
  });

  it("maps Redirect to a SvelteKit redirect with the supplied status and location", () => {
    const thrown = redirectFor(Cause.fail(new Redirect({ to: "/notes/abc", status: 303 })));
    expect(thrown.status).toBe(303);
    expect(thrown.location).toBe("/notes/abc");
  });

  it("defaults a non-3xx redirect status to 303", () => {
    const thrown = redirectFor(Cause.fail(new Redirect({ to: "/", status: 200 })));
    expect(thrown.status).toBe(303);
  });

  it("maps a 'status' entry to error(e.status, e.message)", () => {
    const thrown = httpErrorFor(Cause.fail(new HttpError({ status: 409, message: "Conflict" })));
    expect(thrown.status).toBe(409);
    expect(thrown.body.message).toBe("Conflict");
  });

  it("turns an out-of-range 'status' into a 500", () => {
    const thrown = httpErrorFor(Cause.fail(new HttpError({ status: 200, message: "odd" })));
    expect(thrown.status).toBe(500);
  });

  it("hands a function entry full control (a JSON:API document body)", () => {
    const thrown = httpErrorFor(
      Cause.fail(
        new JsonapiError({ status: 422, errors: [{ status: "422", detail: "expected string" }] }),
      ),
    );
    expect(thrown.status).toBe(422);
    const document = Schema.decodeUnknownSync(JsonapiDocumentJson)(thrown.body.message);
    expect(document.errors).toHaveLength(1);
    expect(document.jsonapi.version).toBe("1.1");
  });

  it("splits an App.Error message into error(status, message, properties)", () => {
    const withCode = Errors.toSvelteKit<NotFound>({
      NotFound: {
        status: 404,
        message: (e) => {
          // An App.Error (Kit 3 requires its `status`) with an extra property,
          // which SvelteKit spreads into the body.
          const body = { status: 404, message: `${e.resource} missing`, code: "NOT_FOUND" };
          return body;
        },
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const thrown = thrownBy(withCode, Cause.fail(new NotFound({ resource: "notes", id: "abc" })));
    assert(isHttpError(thrown, 404), "expected a SvelteKit 404 HttpError");
    expect(thrown.body).toEqual({
      status: 404,
      message: "notes missing",
      code: "NOT_FOUND",
    });
    // Kit warns once per call to the deprecated `error(status, body)` overload.
    expect(warn).not.toHaveBeenCalled();
  });

  it("matches a tagged error that surfaced as a defect", () => {
    const thrown = httpErrorFor(Cause.die(new NotFound({ resource: "notes", id: "x" })));
    expect(thrown.status).toBe(404);
  });

  it("wraps an unknown failure in an EffectCauseError by default (SvelteKit.translate)", () => {
    const defect = new Error("boom");
    expect(() => translateError(Cause.die(defect))).toThrow(EffectCauseError);
  });

  it("still passes the Kit control-flow errors through by default", () => {
    const thrown = httpErrorFor(Cause.fail(new KitError(418, "teapot")));
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
  const mockEvent = (): ServerLoadEvent => ({
    ...TestRequestEvent(),
    parent: () => Promise.resolve({}),
    depends: () => undefined,
    untrack: (fn) => fn(),
  });

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
