/**
 * Schema-driven request parsing utilities for SvelteKit server handlers.
 *
 * Each helper reads a part of the current request (route params, search params,
 * JSON body, or form data), validates it against a schema (Effect `Schema` or
 * any Standard Schema V1 validator), and returns the typed output as an
 * `Effect`. A validation failure surfaces as {@link ParseError}.
 *
 * All four utilities require `SvelteKitRequestEvent` in the environment so they
 * compose naturally inside `serverLoad` / `action` / `endpoint` handlers.
 *
 * @example
 * ```ts
 * import { serverLoad } from '@thomasfosterau/effect-sveltekit/server';
 * import { decodeParams, decodeSearchParams } from '@thomasfosterau/effect-sveltekit/server';
 * import { Schema } from 'effect';
 *
 * const Params = Schema.Struct({ id: Schema.String });
 * const Query  = Schema.Struct({ page: Schema.NumberFromString });
 *
 * export const load = serverLoad(() =>
 *   Effect.gen(function* () {
 *     const { id }   = yield* decodeParams(Params);
 *     const { page } = yield* decodeSearchParams(Query);
 *     return { id, page };
 *   }),
 * );
 * ```
 */

import type { StandardSchemaV1 } from "@standard-schema/spec";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import { SvelteKitRequestEvent } from "./runtime.js";
import { toStandardValidator } from "./internal/remote-validators.js";

// ---------------------------------------------------------------------------
// ParseError
// ---------------------------------------------------------------------------

/** A single issue reported by a Standard Schema validator. */
export interface ParseIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
}

/** The schema of a {@link ParseIssue}, so {@link ParseError} can carry it. */
const ParseIssue: Schema.Codec<ParseIssue> = Schema.Struct({
  message: Schema.String,
  path: Schema.optionalKey(
    Schema.Array(Schema.Union([Schema.PropertyKey, Schema.Struct({ key: Schema.PropertyKey })])),
  ),
});

/**
 * Raised when a schema validator rejects the request data.
 *
 * Carry the raw `issues` array from the Standard Schema validator so callers
 * can pattern-match on specific field failures.
 *
 * @example
 * ```ts
 * import { ParseError } from '@thomasfosterau/effect-sveltekit/server';
 * import { Effect } from 'effect';
 *
 * const result = yield* decodeJson(MySchema).pipe(
 *   Effect.catchTag("ParseError", (e) => Effect.succeed({ fallback: true })),
 * );
 * ```
 */
export class ParseError extends Schema.TaggedError<ParseError>()("ParseError", {
  /** The validator's issues, in the order it reported them. */
  issues: Schema.Array(ParseIssue),
}) {}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Validate `value` against `schema` and return the typed output or fail. */
const validate = <I, O>(schema: StandardSchemaV1<I, O>, value: I): Effect.Effect<O, ParseError> =>
  Effect.callback<O, ParseError>((resume) => {
    const resultOrPromise = schema["~standard"].validate(value);
    const settle = (result: StandardSchemaV1.Result<O>) => {
      if (result.issues !== undefined) {
        // SAFETY: a Standard Schema `Issue` differs from `ParseIssue` only in
        // admitting an explicit `path: undefined`, which reads as an absent path.
        const issues = result.issues as ReadonlyArray<ParseIssue>;
        resume(Effect.fail(new ParseError({ issues })));
      } else {
        resume(Effect.succeed(result.value));
      }
    };
    if (resultOrPromise instanceof Promise) {
      resultOrPromise.then(settle, (err) => {
        resume(Effect.fail(new ParseError({ issues: [{ message: String(err) }] })));
      });
    } else {
      settle(resultOrPromise);
    }
  });

/** Normalise an Effect Schema or Standard Schema V1 to Standard Schema V1. */
const normalise = <O>(
  schema: Schema.Schema<O> | StandardSchemaV1<unknown, O>,
): StandardSchemaV1<unknown, O> =>
  // SAFETY: `toStandardValidator` wraps an Effect `Schema<O>` as a Standard
  // Schema with output `O` and passes a Standard Schema through unchanged.
  toStandardValidator(schema) as StandardSchemaV1<unknown, O>;

/** A field's values: the sole value of a single-valued field, else all of them. */
const fieldValue = (values: Array<string>): string | Array<string> => {
  const [first, ...others] = values;
  return first !== undefined && Arr.isReadonlyArrayEmpty(others) ? first : values;
};

/**
 * Collect multi-valued fields (search params, form data) into a plain object,
 * keyed in first-occurrence order.
 */
const collectFields = (
  keys: Iterable<string>,
  getAll: (key: string) => Array<string>,
): Record<string, string | Array<string>> =>
  Rec.fromIterableWith(keys, (key) => [key, fieldValue(getAll(key))]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decode the route `params` object against `schema`.
 *
 * `params` is a plain `Record<string, string>` from the matched URL segments;
 * the schema is free to coerce values (e.g. `Schema.NumberFromString`).
 *
 * @example
 * ```ts
 * const Params = Schema.Struct({ id: Schema.String });
 * const { id } = yield* decodeParams(Params);
 * ```
 */
export const decodeParams = <O>(
  schema: Schema.Schema<O> | StandardSchemaV1<unknown, O>,
): Effect.Effect<O, ParseError, SvelteKitRequestEvent> =>
  Effect.gen(function* () {
    const event = yield* SvelteKitRequestEvent;
    return yield* validate(normalise<O>(schema), event.params);
  });

/**
 * Decode the URL search / query parameters against `schema`.
 *
 * The raw value passed to the validator is a plain object built from
 * `event.url.searchParams` (multiple values for the same key become an array).
 *
 * @example
 * ```ts
 * const Query = Schema.Struct({ page: Schema.NumberFromString });
 * const { page } = yield* decodeSearchParams(Query);
 * ```
 */
export const decodeSearchParams = <O>(
  schema: Schema.Schema<O> | StandardSchemaV1<unknown, O>,
): Effect.Effect<O, ParseError, SvelteKitRequestEvent> =>
  Effect.gen(function* () {
    const event = yield* SvelteKitRequestEvent;
    const { searchParams } = event.url;
    const raw = collectFields(searchParams.keys(), (key) => searchParams.getAll(key));
    return yield* validate(normalise<O>(schema), raw);
  });

/**
 * Parse the request body as JSON and decode it against `schema`.
 *
 * Fails with `ParseError` if the body is not valid JSON or if the schema
 * rejects the parsed value.
 *
 * @example
 * ```ts
 * const Body = Schema.Struct({ name: Schema.String });
 * const { name } = yield* decodeJson(Body);
 * ```
 */
export const decodeJson = <O>(
  schema: Schema.Schema<O> | StandardSchemaV1<unknown, O>,
): Effect.Effect<O, ParseError, SvelteKitRequestEvent> =>
  Effect.gen(function* () {
    const event = yield* SvelteKitRequestEvent;
    const json = yield* Effect.tryPromise<unknown, ParseError>({
      try: () => event.request.json(),
      catch: (err) => new ParseError({ issues: [{ message: `Invalid JSON: ${String(err)}` }] }),
    });
    return yield* validate(normalise<O>(schema), json);
  });

/**
 * Parse the request body as `FormData` and decode it against `schema`.
 *
 * The raw value passed to the validator is a plain object; fields with
 * multiple values (same name) become arrays.
 *
 * @example
 * ```ts
 * const Form = Schema.Struct({ email: Schema.String });
 * const { email } = yield* decodeFormData(Form);
 * ```
 */
export const decodeFormData = <O>(
  schema: Schema.Schema<O> | StandardSchemaV1<unknown, O>,
): Effect.Effect<O, ParseError, SvelteKitRequestEvent> =>
  Effect.gen(function* () {
    const event = yield* SvelteKitRequestEvent;
    const formData = yield* Effect.tryPromise({
      try: () => event.request.formData(),
      catch: (err) =>
        new ParseError({ issues: [{ message: `Failed to read form data: ${String(err)}` }] }),
    });
    const raw = collectFields(formData.keys(), (key) => Arr.map(formData.getAll(key), String));
    return yield* validate(normalise<O>(schema), raw);
  });
