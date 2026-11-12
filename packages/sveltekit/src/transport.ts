/**
 * Effect Schema ⇄ SvelteKit `transport` hook.
 *
 * SvelteKit's universal [`transport`](https://svelte.dev/docs/kit/hooks#Universal-hooks-transport)
 * hook moves custom (non-POJO) values across the server/client boundary — for
 * data returned from `load` functions and from remote functions. Each entry is
 * a {@link Transporter}: a sync `encode` (server) / `decode` (client) pair,
 * where `encode` returns `false` for values it does not handle.
 *
 * An Effect {@link Schema.Codec} is exactly such a pair. {@link transporter}
 * turns a schema into a `Transporter`, and {@link transport} assembles a whole
 * `transport` object from a record of schemas — so `Option`, `DateTime`,
 * branded types, `Schema.Class` instances, tagged errors, etc. round-trip with
 * no hand-written serialization.
 *
 * ```ts
 * // src/hooks.ts
 * import { Hooks } from "@thomasfosterau/effect-sveltekit";
 * import { Schema } from "effect";
 *
 * export const transport = Hooks.transport({
 *   Option: Schema.Option(Schema.Number),
 *   Date: Schema.Date,
 * });
 * ```
 */

import type { Transport, Transporter } from "@sveltejs/kit/hooks";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";

/**
 * Builds a SvelteKit {@link Transporter} from an Effect {@link Schema.Codec}.
 *
 * The decoded `Type` is detected with `Schema.is`; matching values are encoded
 * with `Schema.encodeSync` and wrapped in a single-element tuple. The wrapper
 * guarantees the encoding is truthy — SvelteKit treats a falsy `encode` result
 * (e.g. an encoded `0`, `""`, `false`, or `null`) as "not this type" — and is
 * unwrapped again by `decode` on the client.
 */
export const transporter = <T, E>(schema: Schema.Codec<T, E>): Transporter<T, readonly [E]> => {
  const guard = Schema.is(schema);
  const encode = Schema.encodeSync(schema);
  const decode = Schema.decodeSync(schema);
  return {
    encode: (value) => (guard(value) ? ([encode(value)] as const) : false),
    decode: ([data]) => decode(data),
  };
};

/**
 * Builds a deliberately-lossy {@link Transporter} for a non-POJO wrapper whose
 * contents should *not* round-trip — the value is detected on the server and
 * reconstructed fresh on the client.
 *
 * Unlike {@link transporter} (which needs a round-tripping {@link Schema.Codec}),
 * this is for values that have no meaningful serialization but still need a
 * `transport` entry so SvelteKit doesn't reject them: `encode` returns a truthy
 * marker for matching values, and `decode` ignores it and produces a fresh value
 * from {@link MarkerTransporterOptions.make}.
 *
 * ```ts
 * // A non-serializable handle reconstructed as a fresh, empty instance:
 * export const transport = Hooks.transport({
 *   Live: Hooks.markerTransporter({
 *     guard: (v): v is LiveHandle => v instanceof LiveHandle,
 *     make: () => LiveHandle.empty(),
 *   }),
 * });
 * ```
 */
export const markerTransporter = <T>(
  options: MarkerTransporterOptions<T>,
): Transporter<T, unknown> => {
  const marker = options.marker ?? 1;
  return {
    encode: (value) => (options.guard(value) ? marker : false),
    decode: () => options.make(),
  };
};

/** Options for {@link markerTransporter}. */
export interface MarkerTransporterOptions<T> {
  /** Detect, on the server, values this transporter handles. */
  readonly guard: (value: unknown) => value is T;
  /** Produce a fresh value on the client (the payload is discarded). */
  readonly make: () => T;
  /**
   * The truthy marker `encode` emits (SvelteKit treats a falsy `encode` result
   * as "not this type"). Defaults to `1`.
   */
  readonly marker?: unknown;
}

/**
 * The {@link Transporter} for any `Option` (`effect/Option`), whatever its
 * `Some` holds: register it once as
 * `transport({ Option: optionTransporter })`.
 *
 * It encodes the structure only — `Some(value)` as `[value]`, `None` as `[]` —
 * and leaves the value to SvelteKit's serialiser (devalue), which walks what
 * `encode` returns with the whole `transport` again. So a `Some` may hold
 * anything SvelteKit can already send (a `Date`, a `Map`, a `Set`, a `BigInt`,
 * a `URL`, `undefined`, `null`), another `Option`, or any other registered
 * transport type, and `Some(undefined)` and `Some(null)` stay distinct from
 * `None`.
 *
 * Prefer it to a schema entry such as
 * `Schema.toCodecJson(Schema.Option(Schema.Unknown))`: a JSON codec encodes
 * the value itself, and throws while the page is being serialised (a 500 at
 * run time, with nothing in the types to warn of it) when a `Some` holds a
 * value that is not JSON, such as a `Date` or a nested `Option`. Use a
 * {@link transporter} schema entry only for an `Option` whose value needs
 * a schema's own encoding.
 *
 * `encode` claims only real `Option`s (`Option.isOption`), not look-alike
 * objects such as `{ _tag: "None" }`. Neither function fails; a value inside
 * the `Some` that SvelteKit cannot serialise is rejected by SvelteKit, as it
 * would be outside an `Option`.
 */
export const optionTransporter: Transporter<Option.Option<unknown>, ReadonlyArray<unknown>> = {
  encode: (value) => Option.isOption(value) && (Option.isSome(value) ? [value.value] : []),
  decode: Arr.head,
};

/** An entry accepted by {@link transport}: an Effect schema or a ready Transporter. */
export type TransportEntry = Schema.Codec<any, any> | Transporter;

/**
 * Assembles a SvelteKit `transport` object from a record of entries. Each entry
 * is either an Effect {@link Schema.Codec} (wrapped with {@link transporter}) or
 * a ready {@link Transporter} (e.g. from {@link markerTransporter}), so
 * round-tripping and marker-style values can be mixed. The keys are arbitrary
 * labels (they only need to be stable between server and client).
 */
export const transport = (entries: Record<string, TransportEntry>): Transport =>
  R.map(entries, (entry): Transporter => (Schema.isSchema(entry) ? transporter(entry) : entry));
