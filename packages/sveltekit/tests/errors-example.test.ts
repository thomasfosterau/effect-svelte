/**
 * The `@example` from `src/errors.ts`'s module doc, verbatim (bar the import
 * paths), so the published example is type-checked by `vp check` and executed
 * here. Keep the two in sync.
 */
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

// ---- example start ----
import * as Errors from "../src/errors.js";
import { makeRuntimeAdapter, RequestRuntime } from "../src/request-runtime.js";
import { Layer, Schema } from "effect";

// The application's tagged-error catalogue (usually imported from a shared models package).
class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  resource: Schema.String,
  id: Schema.String,
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

type AppError = NotFound | Forbidden | Redirect | HttpError;

// Apps typically use `RequestRuntime.fromLocals((event) => event.locals.runtime)`.
const AppLayer = Layer.empty;

export const { serverLoad, endpoint } = makeRuntimeAdapter(RequestRuntime.fromLayer(AppLayer), {
  translateError: Errors.toSvelteKit<AppError>({
    NotFound: { status: 404, message: (e) => `${e.resource} ${e.id} not found` },
    Forbidden: 403, // body: the error's own `message`, else "Forbidden"
    Redirect: "redirect", // redirect(e.status, e.to)
    HttpError: "status", // error(e.status, e.message)
  }),
});
// ---- example end ----

const event = () =>
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

describe("Errors module example", () => {
  it.each([
    [
      new NotFound({ resource: "notes", id: "abc" }),
      { status: 404, body: { message: "notes abc not found" } },
    ],
    [new Forbidden({}), { status: 403, body: { message: "Forbidden" } }],
    [new Redirect({ to: "/login", status: 307 }), { status: 307, location: "/login" }],
    [
      new HttpError({ status: 429, message: "Slow down" }),
      { status: 429, body: { message: "Slow down" } },
    ],
  ] as const)("translates %s", async (failure, expected) => {
    const load = serverLoad(() => Effect.fail(failure));
    await expect(load(event())).rejects.toMatchObject(expected);
  });
});
