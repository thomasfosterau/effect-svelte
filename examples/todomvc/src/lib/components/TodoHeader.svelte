<script lang="ts">
  import { Effect } from "effect";
  import { AsyncResult, useReactiveMutation } from "@thomasfosterau/effect-svelte";
  import { TodoRepository, type TodoStorageError } from "../todo-repository";
  import type { TodoStats } from "../model";

  let { stats }: { stats: AsyncResult.AsyncResult<TodoStats, TodoStorageError> } = $props();

  let title = $state("");

  // The thunk passed to useReactiveMutation is evaluated synchronously inside
  // run(), so it can capture the current input value before we clear it.
  const addTodo = useReactiveMutation(["todos"], () => {
    const value = title.trim();
    return Effect.flatMap(TodoRepository, (repo) => repo.add(value));
  });

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && title.trim().length > 0) {
      addTodo.run();
      title = "";
    }
  }

  // Surfacing the count here keeps the prop wired through the AsyncResult
  // type rather than unwrapping it in the parent.
  const placeholder = $derived(
    AsyncResult.isSuccess(stats) && stats.value.total === 0
      ? "What needs to be done?"
      : "What else needs to be done?"
  );
</script>

<header class="header">
  <h1>todos</h1>
  <input class="new-todo" {placeholder} bind:value={title} {onkeydown} />
</header>
