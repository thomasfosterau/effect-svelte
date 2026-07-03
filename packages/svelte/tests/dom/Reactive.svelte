<script lang="ts" generics="A">
  import type { Stream, SubscriptionRef } from "effect";
  import type { RuntimeLike } from "../../src/internal/run.js";
  import { useLiveStream } from "../../src/live-stream.svelte.js";
  import { useSubscriptionRef } from "../../src/subscription.svelte.js";

  let {
    runtime,
    cursorRef,
    makeFor,
  }: {
    runtime: RuntimeLike<never>;
    cursorRef: SubscriptionRef.SubscriptionRef<number>;
    makeFor: (cursor: number) => Stream.Stream<A, string, never>;
  } = $props();

  // Read the cursor reactively; changing it re-runs the stream thunk below and
  // so re-subscribes `useLiveStream`.
  const cursor = useSubscriptionRef(cursorRef, { runtime });
  const live = useLiveStream<A, string, never>(() => makeFor(cursor.current), { runtime });
</script>

<svelte:boundary>
  {#snippet pending()}
    <span data-testid="status">pending</span>
  {/snippet}
  <span data-testid="value">value:{JSON.stringify(await live.promise)}</span>
</svelte:boundary>
