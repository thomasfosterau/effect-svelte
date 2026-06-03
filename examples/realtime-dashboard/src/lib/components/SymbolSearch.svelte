<script lang="ts">
  import { Effect, Stream } from "effect";
  import { SignalEmitter, useStream } from "@thomasfosterau/effect-svelte";
  import { MarketData } from "../market";

  // Bridge Svelte state into an Effect Stream: SignalEmitter is the
  // Svelte → Effect direction.
  const searches = new SignalEmitter<string>();

  let query = $state("");

  // Emit every change of `query` into the stream ($effect tracks `query`).
  $effect(() => {
    searches.emit(query);
  });

  // The Effect side: debounce keystrokes, normalize, drop blanks and
  // duplicates, then look up a quote for each query. Failures are captured
  // with Effect.result so a bad symbol doesn't kill the stream.
  const results = useStream(
    searches.stream.pipe(
      Stream.debounce("300 millis"),
      Stream.map((value) => value.trim().toUpperCase()),
      Stream.filter((value) => value.length > 0),
      Stream.changes,
      Stream.mapEffect((value) =>
        Effect.result(Effect.flatMap(MarketData, (market) => market.lookup(value)))
      )
    )
  );

  const latest = $derived(results.latest);
</script>

<section class="panel">
  <h2>Symbol lookup — SignalEmitter</h2>
  <label for="search">Type a symbol (try BTC, ETH, SOL… or nonsense)</label>
  <input id="search" bind:value={query} placeholder="BTC" autocomplete="off" />

  {#if latest}
    {#if latest._tag === "Success"}
      <p>
        {latest.success.symbol}:
        <strong>
          ${latest.success.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </strong>
      </p>
    {:else}
      <p class="error">Unknown symbol “{latest.failure.symbol}”</p>
    {/if}
  {:else}
    <p class="muted">Results appear here, debounced through Effect streams.</p>
  {/if}
</section>
