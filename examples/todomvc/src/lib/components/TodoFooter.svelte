<script lang="ts">
  import { Effect } from "effect";
  import { reactiveMutation } from "@thomasfosterau/effect-svelte";
  import { TodoRepository } from "../todo-repository";
  import type { TodoFilter, TodoStats } from "../model";

  let { stats, filter }: { stats: TodoStats; filter: TodoFilter } = $props();

  const clearCompleted = reactiveMutation(["todos"], () =>
    Effect.flatMap(TodoRepository, (repo) => repo.clearCompleted)
  );
</script>

<footer class="footer">
  <span class="todo-count">
    <strong>{stats.active}</strong>
    {stats.active === 1 ? "item" : "items"} left
  </span>
  <ul class="filters">
    <li>
      <a href="#/" class:selected={filter === "all"}>All</a>
    </li>
    <li>
      <a href="#/active" class:selected={filter === "active"}>Active</a>
    </li>
    <li>
      <a href="#/completed" class:selected={filter === "completed"}>Completed</a>
    </li>
  </ul>
  {#if stats.completed > 0}
    <button class="clear-completed" onclick={() => clearCompleted.run()}>
      Clear completed
    </button>
  {/if}
</footer>
