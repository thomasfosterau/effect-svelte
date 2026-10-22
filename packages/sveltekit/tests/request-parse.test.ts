import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const run = <A, R>(effect: Effect.Effect<A, ParseError, R>, layer: Layer.Layer<R>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, layer));

const makeEvent = (overrides: Partial<RequestEvent> = {}): RequestEvent =>
  ({
    params: {},
    url: new URL("http://localhost/"),
    request: new Request("http://localhost/"),
    ...overrides,
  }) as unknown as RequestEvent;

const eventLayer = (event: RequestEvent): Layer.Layer<SvelteKitRequestEvent> =>
  Layer.succeed(SvelteKitRequestEvent, event);

// ---------------------------------------------------------------------------
// decodeParams
// ---------------------------------------------------------------------------

describe("decodeParams", () => {
  const ParamsSchema = Schema.Struct({ id: Schema.String });

  it("returns typed params when valid", async () => {
    const event = makeEvent({ params: { id: "abc" } });
    const result = await run(decodeParams(ParamsSchema), eventLayer(event));
    expect(result).toEqual({ id: "abc" });
  });

  it("fails with ParseError when params are invalid", async () => {
    const event = makeEvent({ params: {} });
    const err = await Effect.runPromise(
      Effect.provide(decodeParams(ParamsSchema).pipe(Effect.flip), eventLayer(event)),
    );
    expect(err).toBeInstanceOf(ParseError);
    expect(err._tag).toBe("ParseError");
    expect(err.issues.length).toBeGreaterThan(0);
  });

  it("works with Standard Schema V1 validators directly", async () => {
    const std = Schema.toStandardSchemaV1(ParamsSchema);
    const event = makeEvent({ params: { id: "hello" } });
    const result = await run(decodeParams(std), eventLayer(event));
    expect(result).toEqual({ id: "hello" });
  });

  it("coerces number params with NumberFromString", async () => {
    const NumberParams = Schema.Struct({ page: Schema.NumberFromString });
    const event = makeEvent({ params: { page: "3" } });
    const result = await run(decodeParams(NumberParams), eventLayer(event));
    expect(result).toEqual({ page: 3 });
  });
});

// ---------------------------------------------------------------------------
// decodeSearchParams
// ---------------------------------------------------------------------------

describe("decodeSearchParams", () => {
  const QuerySchema = Schema.Struct({ q: Schema.String });

  it("returns typed search params when valid", async () => {
    const event = makeEvent({ url: new URL("http://localhost/?q=hello") });
    const result = await run(decodeSearchParams(QuerySchema), eventLayer(event));
    expect(result).toEqual({ q: "hello" });
  });

  it("collapses single values to string, multiple to array", async () => {
    const MultiSchema = Schema.Struct({
      tag: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
    });
    const event = makeEvent({ url: new URL("http://localhost/?tag=a&tag=b") });
    const result = await run(decodeSearchParams(MultiSchema), eventLayer(event));
    expect(result).toEqual({ tag: ["a", "b"] });
  });

  it("fails with ParseError for missing required field", async () => {
    const event = makeEvent({ url: new URL("http://localhost/") });
    const err = await Effect.runPromise(
      Effect.provide(decodeSearchParams(QuerySchema).pipe(Effect.flip), eventLayer(event)),
    );
    expect(err).toBeInstanceOf(ParseError);
    expect(err.issues.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// decodeJson
// ---------------------------------------------------------------------------

describe("decodeJson", () => {
  const BodySchema = Schema.Struct({ name: Schema.String });

  const makeJsonEvent = (body: unknown): RequestEvent =>
    makeEvent({
      request: new Request("http://localhost/", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      }),
    });

  it("parses and validates JSON body", async () => {
    const event = makeJsonEvent({ name: "Alice" });
    const result = await run(decodeJson(BodySchema), eventLayer(event));
    expect(result).toEqual({ name: "Alice" });
  });

  it("fails with ParseError when schema rejects", async () => {
    const event = makeJsonEvent({ name: 123 });
    const err = await Effect.runPromise(
      Effect.provide(decodeJson(BodySchema).pipe(Effect.flip), eventLayer(event)),
    );
    expect(err).toBeInstanceOf(ParseError);
    expect(err.issues.length).toBeGreaterThan(0);
  });

  it("fails with ParseError when body is not valid JSON", async () => {
    const event = makeEvent({
      request: new Request("http://localhost/", {
        method: "POST",
        body: "not json",
        headers: { "Content-Type": "application/json" },
      }),
    });
    const err = await Effect.runPromise(
      Effect.provide(decodeJson(BodySchema).pipe(Effect.flip), eventLayer(event)),
    );
    expect(err).toBeInstanceOf(ParseError);
    expect(err.issues[0]?.message).toContain("Invalid JSON");
  });
});

// ---------------------------------------------------------------------------
// decodeFormData
// ---------------------------------------------------------------------------

describe("decodeFormData", () => {
  const FormSchema = Schema.Struct({ email: Schema.String });

  const makeFormEvent = (fields: Record<string, string>): RequestEvent => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return makeEvent({
      request: new Request("http://localhost/", {
        method: "POST",
        body: form,
      }),
    });
  };

  it("parses and validates form data", async () => {
    const event = makeFormEvent({ email: "user@example.com" });
    const result = await run(decodeFormData(FormSchema), eventLayer(event));
    expect(result).toEqual({ email: "user@example.com" });
  });

  it("collapses multiple values for same key into array", async () => {
    const MultiSchema = Schema.Struct({
      tag: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
    });
    const form = new FormData();
    form.append("tag", "x");
    form.append("tag", "y");
    const event = makeEvent({
      request: new Request("http://localhost/", { method: "POST", body: form }),
    });
    const result = await run(decodeFormData(MultiSchema), eventLayer(event));
    expect(result).toEqual({ tag: ["x", "y"] });
  });

  it("fails with ParseError when schema rejects", async () => {
    const event = makeFormEvent({});
    const err = await Effect.runPromise(
      Effect.provide(decodeFormData(FormSchema).pipe(Effect.flip), eventLayer(event)),
    );
    expect(err).toBeInstanceOf(ParseError);
    expect(err.issues.length).toBeGreaterThan(0);
  });
});
