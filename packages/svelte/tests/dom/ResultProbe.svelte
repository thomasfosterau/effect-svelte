<!--
  Minimal harness for the hooks that hold an `AsyncResult` (`useEffect`,
  `useQuery`, `useDerived`, `reactiveQuery`, ...): `use` calls the hook during
  component initialisation and the result renders as text.

  `onSuccess` fires from an `$effect` whenever the result is a `Success`, so a
  test can await the settle instead of polling against a wall clock.
-->
<script lang="ts">
  import type * as AsyncResult from "effect/reactivity/AsyncResult";

  interface Props {
    use: () => { readonly current: AsyncResult.AsyncResult<unknown, unknown> };
    onSuccess?: ((value: unknown) => void) | undefined;
  }

  let { use, onSuccess }: Props = $props();

  // svelte-ignore state_referenced_locally
  const hook = use();

  $effect(() => {
    const current = hook.current;
    if (current._tag === "Success") onSuccess?.(current.value);
  });
</script>

<span data-testid="tag">{hook.current._tag}</span>
<span data-testid="waiting">{String(hook.current.waiting)}</span>
<span data-testid="value">{hook.current._tag === "Success" ? String(hook.current.value) : ""}</span>
