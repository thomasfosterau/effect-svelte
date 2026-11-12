/**
 * `Effect.provide` for an Effect whose requirements are written as a union of
 * what is provided and what is left (`R | Provided`), with the result typed as
 * what is left (`R`).
 *
 * `Effect.provide` / `Effect.provideContext` type their result as
 * `Exclude<Requirements, Provided>`, which TypeScript cannot resolve while
 * `Requirements` contains a type parameter. `Effect.updateContext` states both
 * sides instead, so the same operation type-checks for a generic `R`.
 *
 * Universal: no `$app/*`, no `node:`.
 *
 * @internal
 */

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/**
 * Provides `context` to `effect`, leaving the requirements `R` it does not
 * cover. As `Effect.provideContext` does, the services of `context` win over
 * the ones already in the fiber's context.
 */
export const provideContext = <A, E, R, Provided>(
  effect: Effect.Effect<A, E, R | Provided>,
  context: Context.Context<Provided>,
): Effect.Effect<A, E, R> =>
  Effect.updateContext(effect, (current: Context.Context<R>) => Context.merge(current, context));

/**
 * Builds `layer` in a scope of its own, provides its services to `effect` and
 * closes the scope when `effect` settles, leaving the requirements `R` the
 * layer does not cover: `Effect.provide(effect, layer)`. Fails with the layer's
 * error `LayerError` as well as the Effect's own.
 */
export const provideLayer = <A, E, R, Provided, LayerError>(
  effect: Effect.Effect<A, E, R | Provided>,
  layer: Layer.Layer<Provided, LayerError>,
): Effect.Effect<A, E | LayerError, R> =>
  Effect.scopedWith((scope) =>
    Effect.flatMap(Layer.buildWithScope(layer, scope), (context) =>
      provideContext<A, E, R, Provided>(effect, context),
    ),
  );
