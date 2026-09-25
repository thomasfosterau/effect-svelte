<!-- Harness for `useAtom` on a writable atom: shows the value, and a button that increments it. -->
<script lang="ts">
  import type { Atom } from "effect/unstable/reactivity";
  import { provideAtomRegistry, useAtom, type AtomRegistry } from "../../src/atom.svelte.js";

  interface Props {
    atom: Atom.Writable<number>;
    derived: Atom.Atom<string>;
    registry: AtomRegistry;
  }

  let { atom, derived, registry }: Props = $props();

  // svelte-ignore state_referenced_locally
  provideAtomRegistry(registry);
  const count = useAtom(() => atom);
  const label = useAtom(() => derived);
</script>

<button data-testid="increment" onclick={() => count.set(count.current + 1)}>
  {count.current}
</button>
<p data-testid="label">{label.current}</p>
