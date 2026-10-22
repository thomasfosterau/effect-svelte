import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

/** A service used to prove a hook can run against an explicit typed runtime. */
export class Multiplier extends Context.Service<Multiplier, { readonly factor: number }>()(
  "test/dom/Multiplier",
) {}

export const MultiplierLayer = Layer.succeed(Multiplier, { factor: 3 });
