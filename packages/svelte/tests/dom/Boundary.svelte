<script lang="ts" generics="A">
  import * as Option from "effect/Option";
  import type * as Stream from "effect/Stream";
  import type { RuntimeLike } from "../../src/internal/run.js";
  import { useLiveStream } from "../../src/live-stream.svelte.js";

  let {
    make,
    runtime,
    seed = Option.none(),
  }: {
    make: () => Stream.Stream<A, string, never>;
    runtime: RuntimeLike<never>;
    seed?: Option.Option<A>;
  } = $props();

  const live = Option.isSome(seed)
    ? useLiveStream<A, string, never>(make, { runtime, initial: seed.value })
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
