<script lang="ts">
  import { timeAgo } from "#lib/format.ts";
  import type { Comment } from "#lib/hn/schema.ts";
  import CommentThread from "./CommentThread.svelte";

  let { comment }: { comment: Comment } = $props();

  let collapsed = $state(false);
</script>

{#if comment.text !== null || comment.children.length > 0}
  <div class="comment">
    <p class="meta">
      <button class="toggle" onclick={() => (collapsed = !collapsed)}>
        {collapsed ? "[+]" : "[–]"}
      </button>
      {#if comment.author}
        <a href="/user/{comment.author}">{comment.author}</a>
      {:else}
        <span>[deleted]</span>
      {/if}
      {timeAgo(comment.created_at)}
    </p>
    {#if !collapsed}
      {#if comment.text}
        <!-- The Algolia API returns sanitized HTML for comment bodies. -->
        <div class="text">{@html comment.text}</div>
      {/if}
      <div class="children">
        {#each comment.children as child (child.id)}
          <CommentThread comment={child} />
        {/each}
      </div>
    {/if}
  </div>
{/if}
