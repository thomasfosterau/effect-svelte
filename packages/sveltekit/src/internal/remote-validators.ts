/**
 * Validator-argument helpers for the remote-function wrappers, factored out so
 * they can be unit-tested without importing `$app/server` (which is a SvelteKit
 * virtual module unavailable outside an app build).
 */

import type { StandardSchemaV1 } from "@standard-schema/spec";
import * as P from "effect/Predicate";
import * as Schema from "effect/Schema";

/**
 * Detects a Standard Schema validator via its `~standard` marker property.
 *
 * This cannot be a simple `typeof value === "function"` check on the handler
 * position: some Standard Schema implementations (such as Effect's
 * `Schema.toStandardSchemaV1`) return callable class values, which would be
 * mistaken for handler functions.
 */
export const isStandardSchema = <V>(value: V): value is V & StandardSchemaV1 =>
  P.hasProperty(value, "~standard");

/** True when the argument is the no-validation (bare handler) overload. */
export const isBareHandler = <V>(value: V): boolean =>
  P.isFunction(value) && !isStandardSchema(value) && !Schema.isSchema(value);

/**
 * True for an Effect `Schema` that carries no Standard Schema adapter of its
 * own. Since effect 4.1, `Schema.toStandardSchemaV1` returns a `Schema` with an
 * own `~standard` property, so `Schema.isSchema` alone would wrap it twice.
 * The check is for an own property: an inherited adapter describes a parent
 * class, not this schema.
 */
const isBareSchema = <V>(value: V): value is V & Schema.Top =>
  Schema.isSchema(value) && !Object.hasOwn(value, "~standard");

/**
 * Normalise a validator argument: a bare Effect `Schema` is wrapped with
 * `Schema.toStandardSchemaV1` so callers can pass it directly; a Standard Schema
 * (an Effect `Schema` already converted included) or the `"unchecked"` marker
 * passes through untouched.
 */
export const toStandardValidator = <V>(value: V): StandardValidator<V> =>
  // SAFETY: the inner cast only drops `toStandardSchemaV1`'s compile-time
  // `DecodingServices: never` constraint (the runtime conversion is the same
  // for every schema, and the remote helpers' callers pass schemas whose
  // decoding needs no services); the outer one restates the branch
  // `isBareSchema` took, which TypeScript cannot carry into the conditional
  // return type.
  (isBareSchema(value)
    ? (Schema.toStandardSchemaV1 as (schema: Schema.Top) => StandardSchemaV1)(value)
    : value) as StandardValidator<V>;

/**
 * What {@link toStandardValidator} returns for `V`: a Standard Schema for an
 * Effect `Schema`, else `V` unchanged.
 */
export type StandardValidator<V> = V extends Schema.Top
  ? StandardSchemaV1<V["Encoded"], V["Type"]>
  : V;
