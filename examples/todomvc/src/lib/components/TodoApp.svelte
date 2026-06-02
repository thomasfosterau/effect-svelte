<script lang="ts">
  import { Effect } from "effect";
  import {
    isFailure,
    isSuccess,
    reactiveMutation,
    reactiveQuery,
    useInvalidateKeys,
  } from "@thomasfosterau/effect-svelte";
  import { STORAGE_KEY, TodoRepository } from "../todo-repository";
  import type { TodoFilter } from "../model";
  import TodoHeader from "./TodoHeader.svelte";
  import TodoItem from "./TodoItem.svelte";
  import TodoFooter from "./TodoFooter.svelte";

  // TodoMVC-style hash routing: #/, #/active, #/completed
  const filterFromHash = (hash: string): TodoFilter => {
    const name = hash.replace(/^#\//, "");
    return name === "active" || name === "completed" ? name : "all";
  };

  let filter = $state(filterFromHash(location.hash));

  // reactiveQuery re-runs its effect whenever
  //  - a reactiveMutation invalidates the "todos" key, or
  //  - `filter` changes (read synchronously by the keys thunk, so Svelte
  //    tracks it as a dependency).
  const todos = reactiveQuery(
    () => ["todos", filter],
    () => {
      const current = filter;
      return Effect.gen(function* () {
        const repo = yield* TodoRepository;
        return yield* repo.getFiltered(current);
      });
    }
  );

  // A second query over the same data, keyed only on "todos": invalidating
  // the key re-runs every query that depends on it.
  const stats = reactiveQuery(
    () => ["todos"],
    () => Effect.flatMap(TodoRepository, (repo) => repo.stats)
  );

  // Toggle-all is a mutation: it runs the effect, then invalidates "todos".
  const toggleAll = reactiveMutation(["todos"], () => {
    const completeAll = isSuccess(stats) && stats.value.active > 0;
    return Effect.flatMap(TodoRepository, (repo) => repo.toggleAll(completeAll));
  });

  // Manual invalidation: when another tab edits localStorage, re-run all
  // queries that depend on the "todos" key.
  const invalidate = useInvalidateKeys();

  const allCompleted = $derived(
    isSuccess(stats) && stats.value.total > 0 && stats.value.active === 0
  );
</script>

<svelte:window
  onhashchange={() => (filter = filterFromHash(location.hash))}
  onstorage={(event) => {
    if (event.key === STORAGE_KEY) {
      invalidate(["todos"]);
    }
  }}
/>

<section class="todoapp">
  <TodoHeader {stats} />

  {#if isFailure(todos)}
    <p class="error">Failed to load todos. Try clearing this site's storage.</p>
  {:else if isSuccess(todos)}
    {#if isSuccess(stats) && stats.value.total > 0}
      <section class="main">
        <input
          id="toggle-all"
          class="toggle-all"
          type="checkbox"
          checked={allCompleted}
          onchange={() => toggleAll.run()}
        />
        <label for="toggle-all">Mark all as complete</label>
        <ul class="todo-list">
          {#each todos.value as todo (todo.id)}
            <TodoItem {todo} />
          {/each}
        </ul>
      </section>

      <TodoFooter stats={stats.value} {filter} />
    {/if}
  {/if}
</section>
