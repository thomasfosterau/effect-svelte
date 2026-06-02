<script lang="ts">
  import { Effect } from "effect";
  // Note: the hook is aliased because a local binding named `derived` would
  // clash with Svelte's $derived rune in this component.
  import { derived as derivedEffect, match } from "@thomasfosterau/effect-svelte";
  import { MarketData } from "../market";

  let selected = $state("BTC");

  // derived() re-runs the lookup effect whenever `selected` changes — the
  // thunk reads it synchronously, so Svelte tracks it as a dependency and
  // interrupts the in-flight lookup when it changes.
  const quote = derivedEffect(() => {
    const symbol = selected;
    return Effect.flatMap(MarketData, (market) => market.lookup(symbol));
  });

  // match() folds the AsyncResult into a display string.
  const display = $derived(
    match(quote, {
      initial: () => "—",
      pending: () => "fetching…",
      success: (value) =>
        `$${value.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      failure: () => "lookup failed",
    })
  );

  const symbols = ["BTC", "ETH", "SOL", "ADA", "DOGE"];
</script>

<section class="panel">
  <h2>Spot quote — derived + match</h2>
  <label for="quote-symbol">Symbol</label>
  <select id="quote-symbol" bind:value={selected}>
    {#each symbols as value (value)}
      <option {value}>{value}</option>
    {/each}
  </select>
  <p class="price" class:pending={quote._tag === "pending"}>{display}</p>
</section>
