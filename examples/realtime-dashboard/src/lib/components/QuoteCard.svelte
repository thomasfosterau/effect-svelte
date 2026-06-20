<script lang="ts">
  import { Effect } from "effect";
  import { useDerived, AsyncResult } from "@thomasfosterau/effect-svelte";
  import { MarketData } from "../market";

  let selected = $state("BTC");

  // useDerived() re-runs the lookup effect whenever `selected` changes — the
  // thunk reads it synchronously, so Svelte tracks it as a dependency and
  // interrupts the in-flight lookup when it changes.
  const quote = useDerived(() => {
    const symbol = selected;
    return Effect.flatMap(MarketData, (market) => market.lookup(symbol));
  });

  // Capture `.current` into a $derived local so the match below narrows it.
  const quoteResult = $derived(quote.current);

  // match() folds the AsyncResult into a display string. Because a refresh
  // keeps the result a `Success` (with `waiting: true`), the previous price
  // stays on screen — dimmed via `class:pending` — instead of flashing away.
  const display = $derived(
    AsyncResult.match(quoteResult, {
      onInitial: () => "—",
      onFailure: () => "lookup failed",
      onSuccess: (success) =>
        `$${success.value.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
    })
  );

  const symbols = ["BTC", "ETH", "SOL", "ADA", "DOGE"];
</script>

<section class="panel">
  <h2>Spot quote — useDerived + match</h2>
  <label for="quote-symbol">Symbol</label>
  <select id="quote-symbol" bind:value={selected}>
    {#each symbols as value (value)}
      <option {value}>{value}</option>
    {/each}
  </select>
  <p class="price" class:pending={AsyncResult.isWaiting(quoteResult)}>{display}</p>
</section>
