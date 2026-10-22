<!--
  Direct fixture for `useDebouncedSearch`: exposes the controller's `emit` so a
  test can drive query changes on an ARBITRARY tick (not just synchronously at
  mount), and renders the reactive state.
-->
<script lang="ts">
  import type * as Effect from "effect/Effect";
  import { untrack } from "svelte";
  import type { RuntimeLike } from "../../src/internal/run.js";
  import { useDebouncedSearch } from "../../src/debounced-search.svelte.js";

  interface Option {
    id: string;
    label: string;
  }

  interface Props {
    runtime: RuntimeLike<never>;
    debounceMs?: number;
    onSearch: (query: string) => Effect.Effect<ReadonlyArray<Option>, unknown>;
    expose: (controller: { emit: (q: string) => void }) => void;
  }

  let { runtime, debounceMs = 150, onSearch, expose }: Props = $props();

  // Props seed the fixture once at construction.
  const search = useDebouncedSearch<Option, unknown>(
    untrack(() => ({ search: (q: string) => onSearch(q), debounce: debounceMs, runtime })),
  );
  untrack(() => expose({ emit: (q) => search.emit(q) }));
</script>

<div data-testid="pending">{search.current.pending ? "pending" : "idle"}</div>
<div data-testid="error">{search.current.error}</div>
<ul data-testid="results">
  {#each search.current.results as option (option.id)}
    <li>{option.label}</li>
  {/each}
</ul>
