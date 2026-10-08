<script lang="ts">
  import { Effect } from "effect";
  import {
    AsyncResult,
    useReactiveMutation,
    useReactiveQuery,
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

  // useReactiveQuery re-runs its effect whenever
  //  - a useReactiveMutation invalidates the "todos" key, or
  //  - `filter` changes (read synchronously by the keys thunk, so Svelte
  //    tracks it as a dependency).
  const todos = useReactiveQuery(
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
  const stats = useReactiveQuery(
    () => ["todos"],
    () => Effect.flatMap(TodoRepository, (repo) => repo.stats)
  );

  // Capture each query's `.current` AsyncResult into a $derived local so the
  // `AsyncResult.isSuccess(...)` guards narrow correctly in the template.
  const todosResult = $derived(todos.current);
  const statsResult = $derived(stats.current);

  // Toggle-all is a mutation: it runs the effect, then invalidates "todos".
  const toggleAll = useReactiveMutation(["todos"], () => {
    const completeAll = AsyncResult.isSuccess(statsResult) && statsResult.value.active > 0;
    return Effect.flatMap(TodoRepository, (repo) => repo.toggleAll(completeAll));
  });

  // Manual invalidation: when another tab edits localStorage, re-run all
  // queries that depend on the "todos" key.
  const invalidate = useInvalidateKeys();

  const allCompleted = $derived(
    AsyncResult.isSuccess(statsResult) &&
      statsResult.value.total > 0 &&
      statsResult.value.active === 0
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
  <TodoHeader stats={statsResult} />

  {#if AsyncResult.isFailure(todosResult)}
    <p class="error">Failed to load todos. Try clearing this site's storage.</p>
  {:else if AsyncResult.isSuccess(todosResult)}
    {#if AsyncResult.isSuccess(statsResult) && statsResult.value.total > 0}
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
          {#each todosResult.value as todo (todo.id)}
            <TodoItem {todo} />
          {/each}
        </ul>
      </section>

      <TodoFooter stats={statsResult.value} {filter} />
    {/if}
  {/if}
</section>
