import { describe, expect, it } from "vite-plus/test";
import { Effect, Schema } from "effect";
import {
  isBareHandler,
  isStandardSchema,
  toStandardValidator,
} from "../src/internal/remote-validators.js";

describe("toStandardValidator", () => {
  it("wraps a bare Effect Schema into a Standard Schema", () => {
    const schema = Schema.Struct({ name: Schema.String });
    const wrapped = toStandardValidator(schema);
    expect(isStandardSchema(wrapped)).toBe(true);
    // The wrapped validator round-trips a valid value.
    const result = (wrapped as any)["~standard"].validate({ name: "ada" });
    expect(result.value).toEqual({ name: "ada" });
  });

  it("passes the 'unchecked' marker through untouched", () => {
    expect(toStandardValidator("unchecked")).toBe("unchecked");
  });

  it("passes an existing Standard Schema through untouched", () => {
    const std = Schema.toStandardSchemaV1(Schema.String);
    expect(toStandardValidator(std)).toBe(std);
  });

  it("passes a handler function through untouched", () => {
    const handler = () => Effect.succeed(1);
    expect(toStandardValidator(handler)).toBe(handler);
  });
});

describe("isBareHandler", () => {
  it("is true for a plain handler function", () => {
    expect(isBareHandler(() => Effect.succeed(1))).toBe(true);
  });

  it("is false for an Effect Schema", () => {
    expect(isBareHandler(Schema.Struct({ name: Schema.String }))).toBe(false);
  });

  it("is false for a Standard Schema", () => {
    expect(isBareHandler(Schema.toStandardSchemaV1(Schema.String))).toBe(false);
  });
});
