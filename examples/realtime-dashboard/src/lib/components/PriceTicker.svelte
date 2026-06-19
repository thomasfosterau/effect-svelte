<script lang="ts">
  import { Effect, Stream } from "effect";
  import { AsyncResult, useStream } from "@thomasfosterau/effect-svelte";
  import { MarketData } from "../market";

  let { symbol }: { symbol: string } = $props();

  // Subscribe to the live quote stream for this symbol. The stream starts on
  // mount and is interrupted automatically on unmount. Stream.unwrap lifts
  // the MarketData service requirement into the stream's environment, which
  // the provided runtime satisfies.
  const quotes = useStream(
    Stream.unwrap(Effect.map(MarketData, (market) => market.quotes(symbol)))
  );

  const latest = $derived(quotes.latest);

  // Keep the last 20 quotes for the sparkline.
  const history = $derived(quotes.values.slice(-20));

  const range = $derived.by(() => {
    const prices = history.map((quote) => quote.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return { min, span: max === min ? 1 : max - min };
  });
</script>

<div class="ticker">
  <div class="symbol">{symbol}</div>
  {#if latest}
    <div class="price">
      ${latest.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
    </div>
    <div class={latest.change >= 0 ? "up" : "down"}>
      {latest.change >= 0 ? "▲" : "▼"}
      {Math.abs(latest.change).toFixed(2)}%
    </div>
    <div class="spark">
      {#each history as quote (quote.at)}
        <span style="height: {((quote.price - range.min) / range.span) * 100}%"></span>
      {/each}
    </div>
  {:else if AsyncResult.isFailure(quotes.current)}
    <div class="error">feed error</div>
  {:else}
    <div class="muted">connecting…</div>
  {/if}
</div>
