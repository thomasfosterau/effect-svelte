/**
 * Validator-argument helpers for the remote-function wrappers, factored out so
 * they can be unit-tested without importing `$app/server` (which is a SvelteKit
 * virtual module unavailable outside an app build).
 */

import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Schema } from "effect";

/**
 * Detects a Standard Schema validator via its `~standard` marker property.
 *
 * This cannot be a simple `typeof value === "function"` check on the handler
 * position: some Standard Schema implementations (such as Effect's
 * `Schema.toStandardSchemaV1`) return callable class values, which would be
 * mistaken for handler functions.
 */
export const isStandardSchema = (value: unknown): value is StandardSchemaV1 =>
  value !== null &&
  (typeof value === "object" || typeof value === "function") &&
  "~standard" in value;

/** True when the argument is the no-validation (bare handler) overload. */
export const isBareHandler = (value: unknown): boolean =>
  typeof value === "function" && !isStandardSchema(value) && !Schema.isSchema(value);

/**
 * Normalise a validator argument: a bare Effect `Schema` is wrapped with
 * `Schema.toStandardSchemaV1` so callers can pass it directly; a Standard Schema
 * or the `"unchecked"` marker passes through untouched.
 */
export const toStandardValidator = (value: unknown): unknown =>
  Schema.isSchema(value)
    ? (Schema.toStandardSchemaV1 as (schema: Schema.Top) => StandardSchemaV1)(value)
    : value;
