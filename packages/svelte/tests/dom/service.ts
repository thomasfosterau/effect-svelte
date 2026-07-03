import { Context, Layer } from "effect";

/** A service used to prove a hook can run against an explicit typed runtime. */
export class Multiplier extends Context.Service<Multiplier, { readonly factor: number }>()(
  "test/dom/Multiplier",
) {}

export const MultiplierLayer = Layer.succeed(Multiplier, { factor: 3 });
