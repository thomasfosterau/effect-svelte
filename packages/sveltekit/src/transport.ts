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

import type { Transport, Transporter } from "@sveltejs/kit";
import { Schema } from "effect";

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
 * Assembles a SvelteKit `transport` object from a record of Effect schemas,
 * applying {@link transporter} to each. The keys are arbitrary labels (they
 * only need to be stable between server and client).
 */
export const transport = (schemas: Record<string, Schema.Codec<any, any>>): Transport => {
  const result: Transport = {};
  for (const [name, schema] of Object.entries(schemas)) {
    result[name] = transporter(schema);
  }
  return result;
};
