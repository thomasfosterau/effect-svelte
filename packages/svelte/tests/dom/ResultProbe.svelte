<!--
  Minimal harness for the hooks that hold an `AsyncResult` (`useEffect`,
  `useQuery`, `useDerived`, `useReactiveQuery`, ...): `use` calls the hook during
  component initialisation and the result renders as text.

  `onSuccess` fires from an `$effect` whenever the result is a `Success` (and
  `onFailure` whenever it is a `Failure`), so a test can await the settle
  instead of polling against a wall clock.
-->
<script lang="ts" generics="A, E">
  import * as AsyncResult from "effect/reactivity/AsyncResult";

  interface Props {
    use: () => { readonly current: AsyncResult.AsyncResult<A, E> };
    onSuccess?: ((value: A) => void) | undefined;
    onFailure?: (() => void) | undefined;
  }

  let { use, onSuccess, onFailure }: Props = $props();

  // svelte-ignore state_referenced_locally
  const hook = use();

  $effect(() => {
    const current = hook.current;
    if (AsyncResult.isSuccess(current)) onSuccess?.(current.value);
    if (AsyncResult.isFailure(current)) onFailure?.();
  });
</script>

<span data-testid="tag">{hook.current._tag}</span>
<span data-testid="waiting">{String(hook.current.waiting)}</span>
<span data-testid="value">{AsyncResult.isSuccess(hook.current) ? String(hook.current.value) : ""}</span>
