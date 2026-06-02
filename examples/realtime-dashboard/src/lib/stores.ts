import { Effect, PubSub, SubscriptionRef } from "effect";
import { MarketData } from "./market";

/** The user's portfolio. */
export interface Portfolio {
  readonly cash: number;
  readonly holdings: Readonly<Record<string, number>>;
}

/** An executed trade. */
export interface Trade {
  readonly id: string;
  readonly side: "buy" | "sell";
  readonly symbol: string;
  readonly units: number;
  readonly price: number;
  readonly at: number;
}

/**
 * The portfolio lives in an Effect SubscriptionRef: any component can
 * subscribe to it with `useSubscriptionRef` and effects can update it
 * atomically.
 */
export const portfolioRef = Effect.runSync(
  SubscriptionRef.make<Portfolio>({ cash: 100_000, holdings: {} }),
);

/** Executed trades are broadcast on an Effect PubSub. */
export const tradeBus = Effect.runSync(PubSub.unbounded<Trade>());

/** Error raised when a trade cannot be afforded. */
export class InsufficientFunds {
  readonly _tag = "InsufficientFunds";
  constructor(
    readonly required: number,
    readonly available: number,
  ) {}
}

/**
 * Place a trade: look up the current price, update the portfolio in the
 * SubscriptionRef, and publish the executed trade to the PubSub.
 */
export const placeTrade = (side: "buy" | "sell", symbol: string, units: number) =>
  Effect.gen(function* () {
    const market = yield* MarketData;
    const quote = yield* market.lookup(symbol);
    const cost = quote.price * units;

    yield* SubscriptionRef.updateEffect(portfolioRef, (portfolio) =>
      Effect.gen(function* () {
        const delta = side === "buy" ? -cost : cost;
        const cash = portfolio.cash + delta;
        if (cash < 0) {
          return yield* Effect.fail(new InsufficientFunds(cost, portfolio.cash));
        }
        const held = portfolio.holdings[quote.symbol] ?? 0;
        const heldNext = side === "buy" ? held + units : held - units;
        return {
          cash,
          holdings: { ...portfolio.holdings, [quote.symbol]: heldNext },
        };
      }),
    );

    const trade: Trade = {
      id: Math.random().toString(36).slice(2, 10),
      side,
      symbol: quote.symbol,
      units,
      price: quote.price,
      at: Date.now(),
    };
    yield* PubSub.publish(tradeBus, trade);
    return trade;
  });
