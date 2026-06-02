<script lang="ts">
  import { provideRuntime } from "@thomasfosterau/effect-svelte";
  import { appRuntime } from "./lib/runtime";
  import TodoApp from "./lib/components/TodoApp.svelte";

  // Make the Effect runtime (todo repository + reactivity service) available
  // to every effect-svelte hook in the component tree.
  provideRuntime(appRuntime);
</script>

<TodoApp />

<footer class="info">
  <p>Double-click to edit a todo</p>
  <p>
    Built with
    <a href="https://github.com/thomasfosterau/effect-svelte">effect-svelte</a>
    and
    <a href="https://effect.website">Effect</a>
  </p>
  <p>Part of <a href="https://todomvc.com">TodoMVC</a></p>
</footer>
