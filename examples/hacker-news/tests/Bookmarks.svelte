<!-- The /bookmarks route as SvelteKit renders it: the page inside the root layout. -->
<script lang="ts">
  import Layout from "../src/routes/+layout.svelte";
  import Page from "../src/routes/bookmarks/+page.svelte";
</script>

<Layout data={{ generatedAt: 0 }} params={{}}>
  <Page />
</Layout>
