<script lang="ts">
  import * as Effect from "effect/Effect";
  import type * as ManagedRuntime from "effect/ManagedRuntime";
  import * as Stream from "effect/Stream";
  import { useLiveStream } from "../../src/live-stream.svelte.js";
  import { Multiplier } from "./service.js";

  let { runtime }: { runtime: ManagedRuntime.ManagedRuntime<Multiplier, never> } = $props();

  // The stream requires `Multiplier`; this only type-checks because
  // `options.runtime` provides it (R is constrained to the runtime's services).
  const live = useLiveStream(
    () =>
      Stream.fromEffect(
        Effect.gen(function* () {
          const m = yield* Multiplier;
          return m.factor * 4;
        }),
      ),
    { runtime },
  );
</script>

<svelte:boundary>
  {#snippet pending()}
    <span data-testid="status">pending</span>
  {/snippet}
  <span data-testid="value">value:{await live.promise}</span>
</svelte:boundary>
