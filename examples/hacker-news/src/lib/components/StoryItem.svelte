<script lang="ts">
  import { hostname, timeAgo } from "#lib/format.ts";
  import type { Story } from "#lib/hn/schema.ts";

  let { story }: { story: Story } = $props();
</script>

<li class="story">
  <p class="title">
    {#if story.url}
      <a href={story.url} rel="noreferrer">{story.title}</a>
      <span class="host">({hostname(story.url)})</span>
    {:else}
      <a href="/item/{story.objectID}">{story.title}</a>
    {/if}
  </p>
  <p class="meta">
    {story.points ?? 0} points
    {#if story.author}
      by <a href="/user/{story.author}">{story.author}</a>
    {/if}
    {timeAgo(story.created_at)} |
    <a href="/item/{story.objectID}">{story.num_comments ?? 0} comments</a>
  </p>
</li>
