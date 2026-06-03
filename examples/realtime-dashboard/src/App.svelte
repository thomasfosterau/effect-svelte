<script lang="ts">
  import { provideRuntime } from "@thomasfosterau/effect-svelte";
  import { appRuntime } from "./lib/runtime";
  import { useClock } from "./lib/use-clock.svelte";
  import Connection from "./lib/components/Connection.svelte";
  import Portfolio from "./lib/components/Portfolio.svelte";
  import PriceTicker from "./lib/components/PriceTicker.svelte";
  import QuoteCard from "./lib/components/QuoteCard.svelte";
  import SymbolSearch from "./lib/components/SymbolSearch.svelte";
  import TradeFeed from "./lib/components/TradeFeed.svelte";

  // Make the Effect runtime (market data + reactivity service) available to
  // every effect-svelte hook in the component tree.
  provideRuntime(appRuntime);

  // Custom hook built on getRuntime() — see lib/use-clock.svelte.ts
  const clock = useClock();

  // The Connection panel can be unmounted to demonstrate scope cleanup.
  let connected = $state(true);
  let connectionLog = $state<string[]>([]);

  const logEvent = (message: string) => {
    connectionLog = [...connectionLog, `${new Date().toLocaleTimeString()} ${message}`];
  };
</script>

<div class="app">
  <header>
    <h1>Effect Market Dashboard</h1>
    <span class="clock">{new Date(clock.now).toLocaleTimeString()}</span>
  </header>

  <div class="grid">
    <section class="panel wide">
      <h2>Live prices — useStream</h2>
      <div class="tickers">
        <PriceTicker symbol="BTC" />
        <PriceTicker symbol="ETH" />
        <PriceTicker symbol="SOL" />
        <PriceTicker symbol="ADA" />
      </div>
    </section>

    <Portfolio />

    <TradeFeed />

    <QuoteCard />

    <SymbolSearch />

    <section class="panel">
      <h2>Connection — useScope + useEffect</h2>
      <label>
        <input type="checkbox" bind:checked={connected} />
        Mounted
      </label>
      {#if connected}
        <Connection onEvent={logEvent} />
      {/if}
      <ul class="log">
        {#each connectionLog as entry, index (index)}
          <li>{entry}</li>
        {/each}
      </ul>
    </section>
  </div>
</div>
