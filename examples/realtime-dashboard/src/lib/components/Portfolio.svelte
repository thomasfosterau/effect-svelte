<script lang="ts">
  import { Effect, SubscriptionRef } from "effect";
  import {
    AsyncResult,
    reactiveMutation,
    reactiveStream,
    useSubscriptionRef,
  } from "@thomasfosterau/effect-svelte";
  import { MarketData } from "../market";
  import { placeTrade, portfolioRef } from "../stores";

  // Reactive view of the portfolio SubscriptionRef. Any effect that updates
  // the ref (see placeTrade) is reflected here immediately.
  const portfolio = useSubscriptionRef(portfolioRef);

  // Trade form state.
  let side = $state<"buy" | "sell">("buy");
  let symbol = $state("BTC");
  let units = $state(1);

  // Placing a trade is a reactiveMutation keyed on "portfolio": on success
  // the value-history stream below re-runs. The trade itself updates the
  // SubscriptionRef and publishes to the trade PubSub.
  const trade = reactiveMutation(["portfolio"], () => {
    const currentSide = side;
    const currentSymbol = symbol;
    const currentUnits = units;
    return placeTrade(currentSide, currentSymbol, currentUnits);
  });

  // Portfolio value history: reactiveStream re-runs this snapshot effect
  // every time the "portfolio" key is invalidated, accumulating the results.
  const history = reactiveStream(["portfolio"], () =>
    Effect.gen(function* () {
      const market = yield* MarketData;
      const current = yield* SubscriptionRef.get(portfolioRef);
      let value = current.cash;
      for (const [heldSymbol, heldUnits] of Object.entries(current.holdings)) {
        const quote = yield* market.lookup(heldSymbol);
        value += quote.price * heldUnits;
      }
      return { value, at: Date.now() };
    })
  );

  const symbols = ["BTC", "ETH", "SOL", "ADA", "DOGE"];
</script>

<section class="panel">
  <h2>Portfolio — useSubscriptionRef + reactiveMutation</h2>

  <dl class="stats">
    <dt>Cash</dt>
    <dd>${portfolio.current.cash.toLocaleString(undefined, { maximumFractionDigits: 2 })}</dd>
    {#each Object.entries(portfolio.current.holdings) as [heldSymbol, heldUnits] (heldSymbol)}
      {#if heldUnits !== 0}
        <dt>{heldSymbol}</dt>
        <dd>{heldUnits.toLocaleString()}</dd>
      {/if}
    {/each}
  </dl>

  <form
    onsubmit={(event) => {
      event.preventDefault();
      trade.run();
    }}
  >
    <div class="row">
      <div>
        <label for="trade-side">Side</label>
        <select id="trade-side" bind:value={side}>
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
      </div>
      <div>
        <label for="trade-symbol">Symbol</label>
        <select id="trade-symbol" bind:value={symbol}>
          {#each symbols as value (value)}
            <option {value}>{value}</option>
          {/each}
        </select>
      </div>
      <div>
        <label for="trade-units">Units</label>
        <input id="trade-units" type="number" min="0.1" step="0.1" bind:value={units} />
      </div>
      <button disabled={AsyncResult.isWaiting(trade.current)}>
        {AsyncResult.isWaiting(trade.current) ? "Executing…" : "Trade"}
      </button>
    </div>
  </form>

  {#if AsyncResult.isFailure(trade.current)}
    <p class="error">Trade failed — insufficient funds.</p>
  {/if}

  <h2>Value history — reactiveStream</h2>
  <ul class="feed">
    {#each [...history.values].reverse() as snapshot (snapshot.at)}
      <li>
        <span class="time">{new Date(snapshot.at).toLocaleTimeString()}</span>
        <span>${snapshot.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
      </li>
    {/each}
  </ul>
</section>
