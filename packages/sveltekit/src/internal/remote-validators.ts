/**
 * Validator-argument helpers for the remote-function wrappers, factored out so
 * they can be unit-tested without importing `$app/server` (which is a SvelteKit
 * virtual module unavailable outside an app build).
 */

import type { StandardSchemaV1 } from "@standard-schema/spec";
import type * as Effect from "effect/Effect";
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

/** A remote-function handler that takes no validated input. */
export type EffectVoidHandler<Out, Env> = () => Effect.Effect<Out, unknown, Env>;

/**
 * True when the argument is the no-validation (bare handler) overload: a
 * function that is neither kind of schema, which narrows it to the handler.
 */
export const isBareHandler = <In, Out, Env>(
  value: ValidatorOf<In> | EffectVoidHandler<Out, Env>,
): value is EffectVoidHandler<Out, Env> =>
  P.isFunction(value) && !isStandardSchema(value) && !Schema.isSchema(value);

/**
 * A validator argument whose validated value is `In`: the `"unchecked"`
 * marker (the handler names its own input type), a Standard Schema with output
 * `In`, or an Effect `Schema` of `In` whose decoding needs no services (what
 * `Schema.toStandardSchemaV1` converts).
 */
export type ValidatorOf<In> =
  | "unchecked"
  | StandardSchemaV1<unknown, In>
  | Schema.ConstraintDecoder<In>;

/**
 * True for an Effect `Schema` that carries no Standard Schema adapter of its
 * own, which tells it from the other first arguments of a remote helper. Since
 * effect 4.1, `Schema.toStandardSchemaV1` returns a `Schema` with an own
 * `~standard` property, so `Schema.isSchema` alone would wrap it twice. The
 * check is for an own property: an inherited adapter describes a parent
 * class, not this schema.
 */
const isBareSchema = <In, Out, Env>(
  value: ValidatorOf<In> | EffectVoidHandler<Out, Env>,
): value is Schema.ConstraintDecoder<In> =>
  Schema.isSchema(value) && !Object.hasOwn(value, "~standard");

/**
 * Normalise a validator argument: a bare Effect `Schema` is wrapped with
 * `Schema.toStandardSchemaV1` so callers can pass it directly; a Standard Schema
 * (an Effect `Schema` already converted included) or the `"unchecked"` marker
 * passes through untouched.
 */
export function toStandardValidator<In>(
  value: Exclude<ValidatorOf<In>, "unchecked">,
): StandardSchemaV1<unknown, In>;
/**
 * Normalise a validator argument that may be the `"unchecked"` marker, which
 * passes through untouched like a Standard Schema.
 */
export function toStandardValidator<In>(
  value: ValidatorOf<In>,
): "unchecked" | StandardSchemaV1<unknown, In>;
/**
 * A bare handler, the other first argument of a remote helper, passes through
 * untouched.
 */
export function toStandardValidator<Out, Env>(
  value: EffectVoidHandler<Out, Env>,
): EffectVoidHandler<Out, Env>;
export function toStandardValidator<In, Out, Env>(
  value: ValidatorOf<In> | EffectVoidHandler<Out, Env>,
): "unchecked" | StandardSchemaV1<unknown, In> | EffectVoidHandler<Out, Env> {
  return isBareSchema(value) ? Schema.toStandardSchemaV1(value) : value;
}
