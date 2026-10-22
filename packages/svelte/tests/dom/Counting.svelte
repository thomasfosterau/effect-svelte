<script lang="ts" generics="A">
  import type * as Stream from "effect/Stream";
  import { untrack } from "svelte";
  import type { RuntimeLike } from "../../src/internal/run.js";
  import { useLiveStream } from "../../src/live-stream.svelte.js";

  let {
    make,
    runtime,
  }: {
    make: () => Stream.Stream<A, string, never>;
    runtime: RuntimeLike<never>;
  } = $props();

  // Counts how many times the stream thunk runs — once per reactive-input
  // change, never once per emission. A self-invalidating `$effect` would
  // re-invoke this on every emission instead. Incrementing untracked avoids
  // this counter itself becoming a dependency of the hook's `$effect` (the
  // same hazard the fix under test addresses for `current`).
  let calls = $state(0);

  const live = useLiveStream<A, string, never>(() => {
    untrack(() => {
      calls++;
    });
    return make();
  }, { runtime });
</script>

<span data-testid="calls">{calls}</span>
<span data-testid="waiting">{String(live.current.waiting)}</span>
<span data-testid="tag">{live.current._tag}</span>
<span data-testid="value">{live.current._tag === "Success" ? JSON.stringify(live.current.value) : ""}</span>
