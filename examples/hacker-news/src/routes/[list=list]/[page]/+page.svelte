<script lang="ts">
  import StoryItem from "#lib/components/StoryItem.svelte";
  import { LIST_TITLES, STORIES_PER_PAGE, type ListKind } from "#lib/hn/lists.ts";
  import type { StoryPage } from "#lib/hn/schema.ts";

  // The load for this route is a bare Effect wrapped by the effectKit()
  // plugin, so SvelteKit's generated $types cannot describe the data shape.
  // The data prop is typed manually instead. (Routes using the explicit
  // wrappers — see /item/[id] — get generated types as usual.)
  interface ListPageData {
    readonly list: ListKind;
    readonly page: number;
    readonly stories: StoryPage;
  }

  let { data }: { data: ListPageData } = $props();
</script>

<svelte:head>
  <title>{LIST_TITLES[data.list]} | Effect HN</title>
</svelte:head>

<ol class="stories" start={(data.page - 1) * STORIES_PER_PAGE + 1}>
  {#each data.stories.hits as story (story.objectID)}
    <StoryItem {story} />
  {/each}
</ol>

<nav class="pagination">
  {#if data.page > 1}
    <a href="/{data.list}/{data.page - 1}">‹ Previous</a>
  {/if}
  <span>Page {data.page} of {Math.max(data.stories.nbPages, 1)}</span>
  {#if data.page < data.stories.nbPages}
    <a href="/{data.list}/{data.page + 1}">Next ›</a>
  {/if}
</nav>
