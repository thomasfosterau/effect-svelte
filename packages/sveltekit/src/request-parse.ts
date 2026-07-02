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
import { Data, Effect, Schema } from "effect";
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
export class ParseError extends Data.TaggedError("ParseError")<{
  readonly issues: ReadonlyArray<ParseIssue>;
}> {}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Validate `value` against `schema` and return the typed output or fail. */
const validate = <O>(
  schema: StandardSchemaV1<unknown, O>,
  value: unknown,
): Effect.Effect<O, ParseError> =>
  Effect.callback<O, ParseError>((resume) => {
    const resultOrPromise = schema["~standard"].validate(value);
    const settle = (result: StandardSchemaV1.Result<O>) => {
      if ("issues" in result && result.issues !== undefined) {
        resume(Effect.fail(new ParseError({ issues: result.issues as ReadonlyArray<ParseIssue> })));
      } else {
        resume(Effect.succeed((result as StandardSchemaV1.SuccessResult<O>).value));
      }
    };
    if (resultOrPromise instanceof Promise) {
      resultOrPromise.then(settle, (err: unknown) => {
        resume(Effect.fail(new ParseError({ issues: [{ message: String(err) }] })));
      });
    } else {
      settle(resultOrPromise);
    }
  });

/** Normalise an Effect Schema or Standard Schema V1 to Standard Schema V1. */
const normalise = <O>(schema: unknown): StandardSchemaV1<unknown, O> =>
  toStandardValidator(schema) as StandardSchemaV1<unknown, O>;

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
    const raw: Record<string, string | string[]> = {};
    for (const key of event.url.searchParams.keys()) {
      const values = event.url.searchParams.getAll(key);
      raw[key] = values.length === 1 ? values[0]! : values;
    }
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
    const json = yield* Effect.tryPromise({
      try: () => event.request.json() as Promise<unknown>,
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
    const raw: Record<string, string | string[]> = {};
    for (const key of formData.keys()) {
      const values = formData.getAll(key).map(String);
      raw[key] = values.length === 1 ? values[0]! : values;
    }
    return yield* validate(normalise<O>(schema), raw);
  });
