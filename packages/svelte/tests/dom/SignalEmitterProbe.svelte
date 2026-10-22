<!--
  The `SignalEmitter` TSDoc example as a fixture: a `$effect` emits `count`
  straight away (before `useStream`'s run has connected), and the doubled
  stream renders every value it receives. `expose` lets a test bump `count`
  and, with `deferred`, show the consumer later: `useStream` starts its run the
  first time the template reads it, so until then no run is connected.
-->
<script lang="ts">
  import * as Stream from "effect/Stream";
  import { untrack } from "svelte";
  import type { RuntimeLike } from "../../src/internal/run.js";
  import { SignalEmitter } from "../../src/emitter.js";
  import { useStream } from "../../src/stream.svelte.js";

  interface Props {
    runtime: RuntimeLike<never>;
    deferred?: boolean;
    expose: (controls: { increment: () => void; show: () => void }) => void;
  }

  let { runtime, deferred = false, expose }: Props = $props();
  let shown = $state(untrack(() => !deferred));

  let count = $state(0);
  const emitter = new SignalEmitter<number>();

  $effect(() => {
    emitter.emit(count);
  });

  // Props seed the fixture once at construction.
  const doubled = useStream(
    emitter.stream.pipe(Stream.map((n) => n * 2)),
    untrack(() => ({ runtime })),
  );
  untrack(() =>
    expose({
      increment: () => count++,
      show: () => {
        shown = true;
      },
    }),
  );
</script>

{#if shown}
  <div data-testid="values">{doubled.values.join(",")}</div>
{/if}
