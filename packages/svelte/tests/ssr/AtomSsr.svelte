<script lang="ts">
  import { AsyncResult, Atom } from "effect/reactivity";
  import { Effect } from "effect";
  import { useAtom, useAtomResult } from "../../src/atom.svelte.js";

  let { onEvaluate }: { onEvaluate: () => void } = $props();

  // svelte-ignore state_referenced_locally
  const query = Atom.make(Effect.sync(onEvaluate).pipe(Effect.as("from-effect")));
  const result = useAtomResult(() => query);
  const plain = useAtom(() => Atom.make("plain-value"));
</script>

<p>{AsyncResult.isInitial(result.current) && result.current.waiting ? "loading" : "settled"}</p>
<p>{plain.current}</p>
