<script lang="ts">
  import { enhance } from "$app/forms";
  import StoryItem from "$lib/components/StoryItem.svelte";
  import type { StoryPage } from "$lib/hn/schema";

  // The shape of the `search` action's result (success or fail(400, ...)).
  interface SearchForm {
    readonly query?: string;
    readonly message?: string;
    readonly results?: StoryPage;
  }

  let { form }: { form: SearchForm | null } = $props();

  let searching = $state(false);
</script>

<svelte:head>
  <title>Search | Effect HN</title>
</svelte:head>

<h1>Search</h1>

<form
  method="POST"
  action="?/search"
  class="search-form"
  use:enhance={() => {
    searching = true;
    return async ({ update }) => {
      searching = false;
      await update();
    };
  }}
>
  <input name="query" value={form?.query ?? ""} placeholder="Search stories…" />
  <button disabled={searching}>{searching ? "Searching…" : "Search"}</button>
</form>

{#if form?.message}
  <p class="error">{form.message}</p>
{/if}

{#if form?.results}
  <p class="meta">{form.results.nbHits} results</p>
  <ol class="stories">
    {#each form.results.hits as story (story.objectID)}
      <StoryItem {story} />
    {/each}
  </ol>
{/if}
