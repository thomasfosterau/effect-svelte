/**
 * A `translateError` built from a **tagged-error catalogue** instead of a
 * hand-written switch.
 *
 * Every application maps the same handful of domain errors to SvelteKit control
 * flow at the request boundary — `NotFound → error(404)`, `Forbidden → 403`,
 * `Unauthorized → 401`, `Redirect → redirect()`, the catch-all HTTP error →
 * `error(status)` — and re-throws everything else so `handleError` sees the
 * defect. {@link toSvelteKit} takes that mapping as data, keyed by `_tag`, and
 * returns the {@link KitErrorTranslator} that `makeRuntimeAdapter` /
 * `RemoteFunction.withRuntime` accept.
 *
 * @example
 * ```ts
 * // src/lib/server/effect/kit.ts
 * import { Errors, makeRuntimeAdapter, RequestRuntime } from "@thomasfosterau/effect-sveltekit/server";
 * import { Layer, Schema } from "effect";
 *
 * // The application's tagged-error catalogue (usually imported from a shared models package).
 * class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
 *   resource: Schema.String,
 *   id: Schema.String,
 * }) {}
 * class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", {
 *   message: Schema.optional(Schema.String),
 * }) {}
 * class Redirect extends Schema.TaggedError<Redirect>()("Redirect", {
 *   to: Schema.String,
 *   status: Schema.Number,
 * }) {}
 * class HttpError extends Schema.TaggedError<HttpError>()("HttpError", {
 *   status: Schema.Number,
 *   message: Schema.String,
 * }) {}
 *
 * type AppError = NotFound | Forbidden | Redirect | HttpError;
 *
 * // Apps typically use `RequestRuntime.fromLocals((event) => event.locals.runtime)`.
 * const AppLayer = Layer.empty;
 *
 * export const { serverLoad, endpoint } = makeRuntimeAdapter(RequestRuntime.fromLayer(AppLayer), {
 *   translateError: Errors.toSvelteKit<AppError>({
 *     NotFound: { status: 404, message: (e) => `${e.resource} ${e.id} not found` },
 *     Forbidden: 403, // body: the error's own `message`, else "Forbidden"
 *     Redirect: "redirect", // redirect(e.status, e.to)
 *     HttpError: "status", // error(e.status, e.message)
 *   }),
 * });
 * ```
 *
 * @module
 */

import { redirect as kitRedirect } from "@sveltejs/kit";
import * as Cause from "effect/Cause";
import * as Predicate from "effect/Predicate";
import { throwKitError } from "./internal/error.js";
import { SvelteKit, type KitErrorTranslator } from "./kit.js";

/** Any value carrying a string `_tag` — `Schema.TaggedError`, `Data.TaggedError`, … */
export interface Tagged {
  readonly _tag: string;
}

/** A 4xx / 5xx status for SvelteKit's `error()`. */
export type ErrorStatus = number;

/**
 * How one tag is translated.
 *
 * - `404` (a status) — `error(status, body)`. The body is the error's own
 *   non-empty `message` field, else its `_tag`.
 * - `{ status, message }` — `error(status, message(e))`; `message` may return a
 *   string or an `App.Error` object.
 * - `"status"` — `error(e.status, body)`, for a catch-all error that carries its
 *   own status (a non-4xx/5xx status becomes `500`).
 * - `"redirect"` — `redirect(e.status, e.to ?? e.location)`; a missing or
 *   non-3xx status becomes `303`.
 * - a function — full control: throw any SvelteKit primitive (`error`,
 *   `redirect`, `invalid`, …) or anything else.
 */
export type CatalogueEntry<E> =
  | ErrorStatus
  | {
      readonly status: ErrorStatus;
      readonly message?: ((error: E) => string | App.Error) | undefined;
    }
  | "status"
  | "redirect"
  | ((error: E) => never);

/**
 * A tag-keyed catalogue. With an explicit error union `E`, keys are limited to
 * `E`'s tags and each entry's functions receive the matching member.
 */
export type Catalogue<E extends Tagged> = {
  readonly [K in E["_tag"]]?: CatalogueEntry<Extract<E, { readonly _tag: K }>>;
};

/** Options for {@link toSvelteKit}. */
export interface ToSvelteKitOptions {
  /**
   * What to do with a cause whose error is not in the catalogue. Defaults to
   * {@link SvelteKit.translate}: the Kit control-flow errors
   * (`SvelteKit.redirect` / `.error` / `.fail`) and SvelteKit's own thrown
   * `redirect()` / `error()` pass through, anything else becomes an
   * `EffectCauseError` (a 500 whose `cause` is the full Effect `Cause`).
   *
   * Pass {@link rethrowSquashed} to rethrow the squashed error unchanged
   * instead, so `handleError` sees the original value.
   */
  readonly fallback?: KitErrorTranslator | undefined;
}

/** A {@link ToSvelteKitOptions.fallback} that rethrows `Cause.squash(cause)` unchanged. */
export const rethrowSquashed: KitErrorTranslator = (cause) => {
  throw Cause.squash(cause);
};

const isTagged = (value: unknown): value is Tagged =>
  Predicate.hasProperty(value, "_tag") && Predicate.isString(value._tag);

const isErrorStatus = (status: number | undefined): status is number =>
  status !== undefined && Number.isInteger(status) && status >= 400 && status <= 599;

const isRedirectStatus = (
  status: number | undefined,
): status is 300 | 301 | 302 | 303 | 304 | 305 | 306 | 307 | 308 =>
  status !== undefined && Number.isInteger(status) && status >= 300 && status <= 308;

/** The error's own non-empty `message` field, else its `_tag`. */
const defaultBody = (error: Tagged): string =>
  Object.hasOwn(error, "message") &&
  Predicate.hasProperty(error, "message") &&
  Predicate.isString(error.message) &&
  error.message !== ""
    ? error.message
    : error._tag;

const throwError = (status: number, body: string | App.Error): never => throwKitError(status, body);

/** The error's numeric `status` field, if it has one. */
const statusField = (error: Tagged): number | undefined =>
  Predicate.hasProperty(error, "status") && Predicate.isNumber(error.status)
    ? error.status
    : undefined;

/** The error's redirect target: its `to` field, else its `location`, if a string or `URL`. */
const locationField = (error: Tagged): string | URL | undefined => {
  const to = Predicate.hasProperty(error, "to") ? error.to : undefined;
  const location = to ?? (Predicate.hasProperty(error, "location") ? error.location : undefined);
  return Predicate.isString(location) || location instanceof URL ? location : undefined;
};

const apply = (entry: CatalogueEntry<Tagged>, error: Tagged): never => {
  if (Predicate.isNumber(entry)) return throwError(entry, defaultBody(error));
  if (Predicate.isFunction(entry)) return entry(error);
  const status = statusField(error);
  if (entry === "status") {
    return throwError(isErrorStatus(status) ? status : 500, defaultBody(error));
  }
  if (entry === "redirect") {
    return kitRedirect(isRedirectStatus(status) ? status : 303, locationField(error) ?? "/");
  }
  return throwError(
    entry.status,
    entry.message === undefined ? defaultBody(error) : entry.message(error),
  );
};

/**
 * Build a `translateError` from a tag-keyed catalogue.
 *
 * The translator squashes the failed `Cause` (the first typed failure, else the
 * first defect — so a tagged error that was thrown also matches), looks its
 * `_tag` up in `catalogue`, and throws the matching SvelteKit primitive. Errors
 * outside the catalogue go to `options.fallback` (by default
 * {@link SvelteKit.translate}).
 *
 * Pass the application's error union as the type argument to have the keys and
 * each entry's callbacks checked against it (a callback reads the matching
 * member's fields); without it any tag is a key, and a callback receives only
 * a {@link Tagged}.
 *
 * @example
 * ```ts
 * import { Errors } from "@thomasfosterau/effect-sveltekit/server";
 * import { error } from "@sveltejs/kit";
 * import type { AppError } from "$lib/errors"; // your tagged-error union
 *
 * const translateError = Errors.toSvelteKit<AppError>({
 *   NotFound: 404,
 *   Unauthorized: 401,
 *   Forbidden: 403,
 *   Redirect: "redirect",
 *   HttpError: "status",
 *   // Full control for anything bespoke, e.g. a JSON:API error document:
 *   JsonapiError: (e) => error(e.status, JSON.stringify(e.toDocument())),
 * });
 * ```
 */
export const toSvelteKit = <E extends Tagged = Tagged>(
  catalogue: Catalogue<E>,
  options: ToSvelteKitOptions = {},
): KitErrorTranslator => {
  // SAFETY: every key of a `Catalogue<E>` is one of `E`'s tags and its entry is
  // a `CatalogueEntry` of the matching member, which `apply` only ever calls
  // with an error of that tag; the lookup below is guarded by `Object.hasOwn`,
  // so absent keys read `undefined`.
  const entries = catalogue as Readonly<Record<string, CatalogueEntry<Tagged> | undefined>>;
  const fallback = options.fallback ?? SvelteKit.translate;
  return (cause) => {
    const squashed = Cause.squash(cause);
    if (isTagged(squashed) && Object.hasOwn(entries, squashed._tag)) {
      const entry = entries[squashed._tag];
      if (entry !== undefined) return apply(entry, squashed);
    }
    return fallback(cause);
  };
};
