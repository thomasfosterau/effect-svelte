<script lang="ts">
  import { timeAgo } from "#lib/format.ts";
  import type { User } from "#lib/hn/schema.ts";

  let { data }: { data: { user: User } } = $props();
</script>

<svelte:head>
  <title>{data.user.username} | Effect HN</title>
</svelte:head>

<section class="user">
  <h1>{data.user.username}</h1>
  <dl>
    <dt>karma</dt>
    <dd>{data.user.karma}</dd>
    <dt>joined</dt>
    <dd>{timeAgo(data.user.created_at)}</dd>
    {#if data.user.about}
      <dt>about</dt>
      <!-- The Algolia API returns sanitized HTML for the about field. -->
      <dd>{@html data.user.about}</dd>
    {/if}
  </dl>
  <p>
    <a href="https://news.ycombinator.com/user?id={data.user.username}" rel="noreferrer">
      View on Hacker News
    </a>
  </p>
</section>
