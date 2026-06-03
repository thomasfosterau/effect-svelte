import { Layer } from "effect";
import { Reactivity } from "effect/unstable/reactivity";
import { SvelteRuntime } from "@thomasfosterau/effect-svelte";
import { MarketData } from "./market";

/**
 * The dashboard runtime: the base Svelte runtime extended with
 *
 * - `MarketData` — the simulated market data feed, and
 * - `Reactivity` — needed by `reactiveMutation` / `reactiveStream`
 *   (used for the portfolio history panel).
 */
export const appRuntime = SvelteRuntime.extend(Layer.merge(MarketData.layer, Reactivity.layer));
