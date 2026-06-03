<script lang="ts">
  import { page } from "$app/state";
  import { provideRuntime } from "@thomasfosterau/effect-svelte";
  import "../app.css";
  import type { LayoutProps } from "./$types";

  let { children, data }: LayoutProps = $props();

  // Client-side Effect runtime for the effect-svelte hooks used in
  // components (see the /bookmarks page).
  provideRuntime();

  const links = [
    { href: "/top/1", prefix: "/top", label: "Top" },
    { href: "/new/1", prefix: "/new", label: "New" },
    { href: "/ask/1", prefix: "/ask", label: "Ask" },
    { href: "/show/1", prefix: "/show", label: "Show" },
    { href: "/search", prefix: "/search", label: "Search" },
    { href: "/bookmarks", prefix: "/bookmarks", label: "Bookmarks" },
  ];
</script>

<div class="app">
  <header class="header">
    <nav>
      <a href="/top/1" class="brand">Effect HN</a>
      {#each links as { href, prefix, label } (href)}
        <a {href} class:active={page.url.pathname.startsWith(prefix)}>{label}</a>
      {/each}
    </nav>
  </header>

  <main>
    {@render children()}
  </main>

  <footer class="footer">
    <p>
      Hacker News reader built with
      <a href="https://github.com/thomasfosterau/effect-svelte">effect-svelte</a>
      and <a href="https://effect.website">Effect</a>. Data from the
      <a href="https://hn.algolia.com/api">Algolia Hacker News API</a>.
      Server rendered at {new Date(data.generatedAt).toLocaleTimeString()}.
    </p>
  </footer>
</div>
