<script lang="ts">
  import { Effect } from "effect";
  import { AsyncResult, reactiveMutation } from "@thomasfosterau/effect-svelte";
  import { TodoRepository } from "../todo-repository";
  import type { Todo } from "../model";

  let { todo }: { todo: Todo } = $props();

  let editing = $state(false);
  let editText = $state("");

  // Each item owns its mutations. Running any of them invalidates the
  // "todos" key, which re-runs the queries in TodoApp.
  const toggle = reactiveMutation(["todos"], () =>
    Effect.flatMap(TodoRepository, (repo) => repo.toggle(todo.id))
  );

  const destroy = reactiveMutation(["todos"], () =>
    Effect.flatMap(TodoRepository, (repo) => repo.remove(todo.id))
  );

  const save = reactiveMutation(["todos"], () => {
    const value = editText.trim();
    return Effect.flatMap(TodoRepository, (repo) =>
      value.length === 0 ? repo.remove(todo.id) : repo.update(todo.id, value)
    );
  });

  function startEditing() {
    editText = todo.title;
    editing = true;
  }

  function finishEditing() {
    if (editing) {
      editing = false;
      save.run();
    }
  }

  function onEditKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      finishEditing();
    } else if (event.key === "Escape") {
      editing = false;
    }
  }

  /** Svelte action: focus the edit input as soon as it appears. */
  function focusOnMount(node: HTMLInputElement) {
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }

  const busy = $derived(
    AsyncResult.isWaiting(toggle.current) ||
      AsyncResult.isWaiting(destroy.current) ||
      AsyncResult.isWaiting(save.current)
  );
</script>

<li class:completed={todo.completed} class:editing>
  <div class="view">
    <input
      class="toggle"
      type="checkbox"
      checked={todo.completed}
      disabled={busy}
      onchange={() => toggle.run()}
    />
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_label_has_associated_control -->
    <label ondblclick={startEditing}>{todo.title}</label>
    <button
      class="destroy"
      aria-label="Delete {todo.title}"
      onclick={() => destroy.run()}
    ></button>
  </div>
  {#if editing}
    <input
      class="edit"
      bind:value={editText}
      onblur={finishEditing}
      onkeydown={onEditKeydown}
      use:focusOnMount
    />
  {/if}
</li>
