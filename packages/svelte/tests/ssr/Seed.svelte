<script lang="ts">
  import { Stream } from "effect";
  import type { RuntimeLike } from "../../src/internal/run.js";
  import { useLiveStream } from "../../src/live-stream.svelte.js";

  let { initial, runtime }: { initial: string; runtime: RuntimeLike<never> } = $props();

  // The stream thunk is only invoked inside `$effect`, which never runs during
  // SSR — so `promise` is driven purely by the `initial` seed here.
  const live = useLiveStream<string, never, never>(() => Stream.never, { initial, runtime });
</script>

<!--
  A boundary WITHOUT a `pending` snippet: an awaited already-resolved plain
  value renders synchronously server-side. (A boundary WITH a `pending` snippet
  always renders pending during SSR, which is why the seed assertion needs this
  shape.)
-->
<svelte:boundary>
  <p>value:{await live.promise}</p>
</svelte:boundary>
