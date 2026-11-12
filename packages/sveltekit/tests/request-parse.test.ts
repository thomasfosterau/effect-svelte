import { it } from "@effect/vitest";
import { describe, expect } from "vite-plus/test";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
import type { RequestEvent } from "@sveltejs/kit";
import { SvelteKitRequestEvent } from "../src/runtime.js";
import {
  ParseError,
  decodeFormData,
  decodeJson,
  decodeParams,
  decodeSearchParams,
} from "../src/request-parse.js";
import { TestRequestEvent } from "../src/testing.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const run = <A, R>(
  effect: Effect.Effect<A, ParseError, R>,
  layer: Layer.Layer<R>,
): Effect.Effect<A, ParseError> => Effect.provide(effect, layer);

const eventLayer = (event: RequestEvent): Layer.Layer<SvelteKitRequestEvent> =>
  Layer.succeed(SvelteKitRequestEvent, event);

// ---------------------------------------------------------------------------
// decodeParams
// ---------------------------------------------------------------------------

describe("decodeParams", () => {
  const ItemParams = Schema.Struct({ id: Schema.String });

  it.effect("returns typed params when valid", () =>
    Effect.gen(function* () {
      const event = TestRequestEvent({ params: { id: "abc" } });
      const result = yield* run(decodeParams(ItemParams), eventLayer(event));
      expect(result).toEqual({ id: "abc" });
    }),
  );

  it.effect("fails with ParseError when params are invalid", () =>
    Effect.gen(function* () {
      const event = TestRequestEvent({ params: {} });
      const err = yield* Effect.provide(
        decodeParams(ItemParams).pipe(Effect.flip),
        eventLayer(event),
      );
      expect(err).toBeInstanceOf(ParseError);
      expect(err._tag).toBe("ParseError");
      expect(err.issues.length).toBeGreaterThan(0);
    }),
  );

  it.effect("works with Standard Schema V1 validators directly", () =>
    Effect.gen(function* () {
      const std = Schema.toStandardSchemaV1(ItemParams);
      const event = TestRequestEvent({ params: { id: "hello" } });
      const result = yield* run(decodeParams(std), eventLayer(event));
      expect(result).toEqual({ id: "hello" });
    }),
  );

  it.effect("coerces number params with NumberFromString", () =>
    Effect.gen(function* () {
      const NumberParams = Schema.Struct({ page: Schema.NumberFromString });
      const event = TestRequestEvent({ params: { page: "3" } });
      const result = yield* run(decodeParams(NumberParams), eventLayer(event));
      expect(result).toEqual({ page: 3 });
    }),
  );
});

// ---------------------------------------------------------------------------
// decodeSearchParams
// ---------------------------------------------------------------------------

describe("decodeSearchParams", () => {
  const SearchQuery = Schema.Struct({ q: Schema.String });

  it.effect("returns typed search params when valid", () =>
    Effect.gen(function* () {
      const event = TestRequestEvent({ url: new URL("http://localhost/?q=hello") });
      const result = yield* run(decodeSearchParams(SearchQuery), eventLayer(event));
      expect(result).toEqual({ q: "hello" });
    }),
  );

  it.effect("collapses single values to string, multiple to array", () =>
    Effect.gen(function* () {
      const TaggedFields = Schema.Struct({
        tag: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
      });
      const event = TestRequestEvent({ url: new URL("http://localhost/?tag=a&tag=b") });
      const result = yield* run(decodeSearchParams(TaggedFields), eventLayer(event));
      expect(result).toEqual({ tag: ["a", "b"] });
    }),
  );

  it.effect("fails with ParseError for missing required field", () =>
    Effect.gen(function* () {
      const event = TestRequestEvent({ url: new URL("http://localhost/") });
      const err = yield* Effect.provide(
        decodeSearchParams(SearchQuery).pipe(Effect.flip),
        eventLayer(event),
      );
      expect(err).toBeInstanceOf(ParseError);
      expect(err.issues.length).toBeGreaterThan(0);
    }),
  );
});

// ---------------------------------------------------------------------------
// decodeJson
// ---------------------------------------------------------------------------

describe("decodeJson", () => {
  const Person = Schema.Struct({ name: Schema.String });

  const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

  const makeJsonEvent = (body: { readonly name: string | number }): RequestEvent =>
    TestRequestEvent({
      method: "POST",
      body: encodeJson(body),
      headers: { "Content-Type": "application/json" },
    });

  it.effect("parses and validates JSON body", () =>
    Effect.gen(function* () {
      const event = makeJsonEvent({ name: "Alice" });
      const result = yield* run(decodeJson(Person), eventLayer(event));
      expect(result).toEqual({ name: "Alice" });
    }),
  );

  it.effect("fails with ParseError when schema rejects", () =>
    Effect.gen(function* () {
      const event = makeJsonEvent({ name: 123 });
      const err = yield* Effect.provide(decodeJson(Person).pipe(Effect.flip), eventLayer(event));
      expect(err).toBeInstanceOf(ParseError);
      expect(err.issues.length).toBeGreaterThan(0);
    }),
  );

  it.effect("fails with ParseError when body is not valid JSON", () =>
    Effect.gen(function* () {
      const event = TestRequestEvent({
        method: "POST",
        body: "not json",
        headers: { "Content-Type": "application/json" },
      });
      const err = yield* Effect.provide(decodeJson(Person).pipe(Effect.flip), eventLayer(event));
      expect(err).toBeInstanceOf(ParseError);
      expect(err.issues[0]?.message).toContain("Invalid JSON");
    }),
  );
});

// ---------------------------------------------------------------------------
// decodeFormData
// ---------------------------------------------------------------------------

/** A POST event whose body is a form with `fields`. */
const makeFormEvent = (fields: Record<string, string>): RequestEvent => {
  const form = new FormData();
  Arr.forEach(R.toEntries(fields), ([key, value]) => form.append(key, value));
  return TestRequestEvent({ method: "POST", body: form });
};

describe("decodeFormData", () => {
  const SignupForm = Schema.Struct({ email: Schema.String });

  it.effect("parses and validates form data", () =>
    Effect.gen(function* () {
      const event = makeFormEvent({ email: "user@example.com" });
      const result = yield* run(decodeFormData(SignupForm), eventLayer(event));
      expect(result).toEqual({ email: "user@example.com" });
    }),
  );

  it.effect("collapses multiple values for same key into array", () =>
    Effect.gen(function* () {
      const TaggedFields = Schema.Struct({
        tag: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
      });
      const form = new FormData();
      form.append("tag", "x");
      form.append("tag", "y");
      const event = TestRequestEvent({ method: "POST", body: form });
      const result = yield* run(decodeFormData(TaggedFields), eventLayer(event));
      expect(result).toEqual({ tag: ["x", "y"] });
    }),
  );

  it.effect("fails with ParseError when schema rejects", () =>
    Effect.gen(function* () {
      const event = makeFormEvent({});
      const err = yield* Effect.provide(
        decodeFormData(SignupForm).pipe(Effect.flip),
        eventLayer(event),
      );
      expect(err).toBeInstanceOf(ParseError);
      expect(err.issues.length).toBeGreaterThan(0);
    }),
  );
});
