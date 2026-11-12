/**
 * `Errors.toSvelteKit` — the catalogue-driven `translateError`. Every tag in the catalogue becomes one
 * SvelteKit `error()` / `redirect()` throw, and anything outside it falls
 * through untouched.
 */
import { error, isHttpError, isRedirect, type ServerLoadEvent } from "@sveltejs/kit";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { afterEach, assert, describe, expect, expectTypeOf, it, vi } from "vite-plus/test";
import * as Errors from "../src/errors.js";
import { EffectCauseError } from "../src/internal/error.js";
import { KitError } from "../src/kit.js";
import { makeRuntimeAdapter, RequestRuntime } from "../src/request-runtime.js";
import { TestRequestEvent } from "../src/testing.js";
import { ForeignError } from "./fixtures/foreign-error.js";

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
const thrownBy = (
  translate: (cause: Cause.Cause<unknown>) => never,
  cause: Cause.Cause<unknown>,
) => {
  const result = Result.try(() => translate(cause));
  assert(Result.isFailure(result), "expected translate to throw");
  return result.failure;
};

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
    const defect = new ForeignError("boom");
    expect(() => translateError(Cause.die(defect))).toThrow(EffectCauseError);
  });

  it("still passes the Kit control-flow errors through by default", () => {
    const thrown = httpErrorFor(Cause.fail(new KitError(418, "teapot")));
    expect(thrown.status).toBe(418);
  });

  it("rethrows unknown failures unchanged with the rethrowSquashed fallback", () => {
    const defect = new ForeignError("boom");
    const rethrowing = Errors.toSvelteKit<AppError>(
      { NotFound: 404 },
      { fallback: Errors.rethrowSquashed },
    );
    expect(() => rethrowing(Cause.die(defect))).toThrow(defect);
  });

  it("falls back to 500 / 303 / '/' when the error has no status or location field", () => {
    const untyped = Errors.toSvelteKit({ Bare: "status", Away: "redirect" });

    const bare = thrownBy(untyped, Cause.fail({ _tag: "Bare" }));
    assert(isHttpError(bare, 500), "expected a 500 for a 'status' entry without a status");
    expect(bare.body.message).toBe("Bare");

    const nonNumeric = thrownBy(untyped, Cause.fail({ _tag: "Bare", status: "409" }));
    assert(isHttpError(nonNumeric, 500), "expected a 500 for a non-numeric status");

    const away = thrownBy(untyped, Cause.fail({ _tag: "Away" }));
    assert(isRedirect(away), "expected a redirect");
    expect(away.status).toBe(303);
    expect(away.location).toBe("/");
  });

  it("reads a redirect target from `to`, else `location`, and only a string or URL", () => {
    const untyped = Errors.toSvelteKit({ Away: "redirect" });
    const locationOf = (cause: Cause.Cause<Errors.Tagged>) => {
      const thrown = thrownBy(untyped, cause);
      assert(isRedirect(thrown), "expected a redirect");
      return thrown.location;
    };

    expect(locationOf(Cause.fail({ _tag: "Away", to: "/a", location: "/b" }))).toBe("/a");
    expect(locationOf(Cause.fail({ _tag: "Away", location: "/b" }))).toBe("/b");
    // A nullish `to` is absent, so `location` is read.
    expect(locationOf(Cause.fail({ _tag: "Away", to: null, location: "/b" }))).toBe("/b");
    expect(locationOf(Cause.fail({ _tag: "Away", to: undefined, location: "/b" }))).toBe("/b");
    // A `URL` is a target too: it reaches SvelteKit's `redirect()`, which
    // refuses an absolute URL it was not told is external.
    const external = thrownBy(
      untyped,
      Cause.fail({ _tag: "Away", location: new URL("http://localhost/c") }),
    );
    expect(isRedirect(external)).toBe(false);
    expect(external).toBeInstanceOf(Error);
    // A `to` of another type is not a target, and `location` is not consulted.
    expect(locationOf(Cause.fail({ _tag: "Away", to: 42, location: "/b" }))).toBe("/");
  });

  it("treats a catalogue key set to undefined as absent", () => {
    // A JavaScript caller's catalogue: the types reject `{ NotFound: undefined }`.
    const catalogue: Record<string, Errors.CatalogueEntry<Errors.Tagged>> = {};
    Object.defineProperty(catalogue, "NotFound", { value: undefined, enumerable: true });
    const sparse = Errors.toSvelteKit(catalogue);
    expect(() => sparse(Cause.fail({ _tag: "NotFound" }))).toThrow(EffectCauseError);
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
    // `Missing` is not a tag of AppError.
    expectTypeOf(Errors.toSvelteKit<AppError>)
      .parameter(0)
      .not.toHaveProperty("Missing");
    // An entry's callback receives the member with its tag: NotFound, which
    // has no `to` field.
    Errors.toSvelteKit<AppError>({
      NotFound: {
        status: 404,
        message: (e) => {
          expectTypeOf(e).toEqualTypeOf<NotFound>();
          expectTypeOf(e).not.toHaveProperty("to");
          return e.resource;
        },
      },
    });
  });
});

/** A `ServerLoadEvent` for the adapter's `serverLoad`. */
const mockEvent = (): ServerLoadEvent => ({
  ...TestRequestEvent(),
  parent: () => Promise.resolve({}),
  depends: () => undefined,
  untrack: (fn) => fn(),
});

describe("Errors.toSvelteKit through makeRuntimeAdapter", () => {
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
