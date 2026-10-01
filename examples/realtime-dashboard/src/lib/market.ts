import { Context, Effect, Layer, Random, Schedule, Schema, Stream } from "effect";

/** A point-in-time quote for a symbol. */
export interface Quote {
  readonly symbol: string;
  readonly price: number;
  /** Percentage change relative to the previous tick. */
  readonly change: number;
  readonly at: number;
}

/** Error raised when looking up a symbol that does not exist. */
export class SymbolNotFound extends Schema.TaggedError<SymbolNotFound>()("SymbolNotFound", {
  symbol: Schema.String,
}) {}

const BASE_PRICES: Record<string, number> = {
  BTC: 67_000,
  ETH: 3_500,
  SOL: 180,
  ADA: 0.45,
  DOGE: 0.16,
};

/**
 * Simulated market data feed.
 *
 * `quotes` produces an endless Effect Stream of quotes following a random
 * walk; `lookup` is a one-shot quote fetch with simulated latency. Both are
 * pure Effect values, so the UI layer can run them through the hooks of
 * `@thomasfosterau/effect-svelte`.
 */
export class MarketData extends Context.Service<MarketData>()("examples/MarketData", {
  make: Effect.sync(() => {
    const nextQuote = (symbol: string, price: number): Effect.Effect<Quote> =>
      Effect.gen(function* () {
        const drift = yield* Random.nextBetween(-0.01, 0.01);
        return {
          symbol,
          price: price * (1 + drift),
          change: drift * 100,
          at: Date.now(),
        };
      });

    return {
      /** The symbols this feed knows about. */
      symbols: Object.keys(BASE_PRICES),

      /** An endless stream of quotes for a symbol, one per interval. */
      quotes: (symbol: string) => {
        const base = BASE_PRICES[symbol] ?? 100;
        return Stream.unfold(base, (price) =>
          nextQuote(symbol, price).pipe(Effect.map((quote) => [quote, quote.price] as const)),
        ).pipe(Stream.schedule(Schedule.spaced("1 second")));
      },

      /** A one-shot quote lookup with simulated network latency. */
      lookup: (rawSymbol: string) =>
        Effect.gen(function* () {
          yield* Effect.sleep("400 millis");
          const symbol = rawSymbol.trim().toUpperCase();
          const base = BASE_PRICES[symbol];
          if (base === undefined) {
            return yield* new SymbolNotFound({ symbol });
          }
          return yield* nextQuote(symbol, base);
        }),
    } as const;
  }),
}) {
  /** The layer providing the simulated market data feed. */
  static readonly layer = Layer.effect(this, this.make);
}
