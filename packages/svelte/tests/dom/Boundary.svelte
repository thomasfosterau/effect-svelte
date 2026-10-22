<script lang="ts" generics="A">
  import type * as Stream from "effect/Stream";
  import type { RuntimeLike } from "../../src/internal/run.js";
  import { useLiveStream } from "../../src/live-stream.svelte.js";

  let {
    make,
    runtime,
    initial,
    hasInitial = false,
  }: {
    make: () => Stream.Stream<A, string, never>;
    runtime: RuntimeLike<never>;
    initial?: A;
    hasInitial?: boolean;
  } = $props();

  // SAFETY: the only caller passing `hasInitial: true` (live-stream.test.ts)
  // also passes `initial`, so here `initial` holds the caller's `A`.
  const live = hasInitial
    ? useLiveStream<A, string, never>(make, { runtime, initial: initial as A })
    : useLiveStream<A, string, never>(make, { runtime });
</script>

<svelte:boundary>
  {#snippet pending()}
    <span data-testid="status">pending</span>
  {/snippet}
  {#snippet failed(error)}
    <span data-testid="error">error:{String(error)}</span>
  {/snippet}
  <span data-testid="value">value:{JSON.stringify(await live.promise)}</span>
</svelte:boundary>
