<script lang="ts">
  import CommentThread from "$lib/components/CommentThread.svelte";
  import { hostname, timeAgo } from "$lib/format";
  import type { Item } from "$lib/hn/schema";

  // The explicit serverLoad wrapper preserves the load's return type, so
  // PageProps from ./$types would work here too; the prop is typed
  // explicitly to keep the example self-contained.
  let { data }: { data: { item: Item } } = $props();

  const countComments = (comments: Item["children"]): number =>
    comments.reduce(
      (total, comment) => total + 1 + countComments(comment.children),
      0
    );
</script>

<svelte:head>
  <title>{data.item.title ?? "Item"} | Effect HN</title>
</svelte:head>

<article class="item">
  <h1>
    {#if data.item.url}
      <a href={data.item.url} rel="noreferrer">{data.item.title}</a>
      <span class="host">({hostname(data.item.url)})</span>
    {:else}
      {data.item.title}
    {/if}
  </h1>
  <p class="meta">
    {data.item.points ?? 0} points
    {#if data.item.author}
      by <a href="/user/{data.item.author}">{data.item.author}</a>
    {/if}
    {timeAgo(data.item.created_at)} | {countComments(data.item.children)} comments
  </p>
  {#if data.item.text}
    <!-- The Algolia API returns sanitized HTML for story bodies. -->
    <div class="text">{@html data.item.text}</div>
  {/if}
</article>

<section class="comments">
  {#each data.item.children as comment (comment.id)}
    <CommentThread {comment} />
  {/each}
</section>
