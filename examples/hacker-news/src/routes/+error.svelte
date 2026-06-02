<script lang="ts">
  import { page } from "$app/state";
</script>

<svelte:head>
  <title>{page.status} | Effect HN</title>
</svelte:head>

<h1>{page.status}</h1>
<p>{page.error?.message ?? "Something went wrong."}</p>
<p><a href="/top/1">Back to the front page</a></p>
