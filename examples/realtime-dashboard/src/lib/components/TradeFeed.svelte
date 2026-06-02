<script lang="ts">
  import { usePubSub } from "@thomasfosterau/effect-svelte";
  import { tradeBus } from "../stores";

  // Collects every trade published to the PubSub while this component is
  // mounted. The subscription is released on unmount.
  const trades = usePubSub(tradeBus);
</script>

<section class="panel">
  <h2>Trade feed — usePubSub</h2>
  {#if trades.values.length === 0}
    <p class="muted">No trades yet. Place one from the portfolio panel.</p>
  {:else}
    <ul class="feed">
      {#each [...trades.values].reverse() as trade (trade.id)}
        <li>
          <span class="time">{new Date(trade.at).toLocaleTimeString()}</span>
          <span class={trade.side === "buy" ? "up" : "down"}>
            {trade.side.toUpperCase()}
          </span>
          <span>{trade.units} {trade.symbol}</span>
          <span class="muted">@ ${trade.price.toFixed(2)}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>
