<!--
  Minimal harness for `useAtomResult`: renders one atom's `AsyncResult` as text,
  so a test can assert what the bridge reads and when it re-reads.

  The atom is chosen by `select(key)` rather than passed directly, so a test can
  change `key` and check the hook follows the thunk to a different atom — the
  shape a real page has, where a query atom's identity is its request.
-->
<script lang="ts">
  import { AsyncResult, type Atom } from "effect/unstable/reactivity";
  import { useAtomResult, type AtomRegistry } from "../../src/atom.svelte.js";

  interface Props {
    select: (key: string) => Atom.Atom<AsyncResult.AsyncResult<string>>;
    key?: string;
    registry?: AtomRegistry | undefined;
  }

  let { select, key = "default", registry }: Props = $props();

  // svelte-ignore state_referenced_locally
  const view = useAtomResult(() => select(key), { registry });

  const text = $derived(
    AsyncResult.isSuccess(view.current)
      ? view.current.value
      : AsyncResult.isFailure(view.current)
        ? "failed"
        : "loading",
  );
</script>

<p data-testid="atom-state">{text}</p>
