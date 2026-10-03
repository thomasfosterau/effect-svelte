<script lang="ts">
  import { Effect } from "effect";
  import { AsyncResult, useEffect, useQuery } from "@thomasfosterau/effect-svelte";
  import { Remote } from "@thomasfosterau/effect-sveltekit";
  import { timeAgo } from "#lib/format.ts";
  import { addBookmark, getBookmarks, removeBookmark } from "./bookmarks.remote";

  // -- Reading -------------------------------------------------------------
  // callQuery wraps the SvelteKit remote query in an Effect; useQuery runs it
  // through the client-side Effect runtime and exposes an AsyncResult.
  const bookmarks = useQuery(Remote.callQuery(getBookmarks));

  // Capture `.current` into a $derived local so the guards below narrow it.
  const bookmarksResult = $derived(bookmarks.current);

  // -- Removing ------------------------------------------------------------
  // A single useEffect hook serves every row: the id to remove is read from
  // $state inside Effect.suspend when run() is called.
  //
  // SvelteKit caches remote query instances, so the command lists the
  // queries it invalidates (single-flight mutation); the refetch then reads
  // the refreshed cache.
  let removingId = $state<string | null>(null);

  const remove = useEffect(
    Effect.suspend(() => {
      const id = removingId;
      if (id === null) {
        return Effect.void;
      }
      return Remote.callCommandWithUpdates(removeBookmark, id, getBookmarks()).pipe(
        // Re-run the query so the list updates.
        Effect.tap(() => Effect.sync(() => bookmarks.refetch()))
      );
    })
  );

  function removeOne(id: string) {
    removingId = id;
    remove.run();
  }
</script>

<svelte:head>
  <title>Bookmarks | Effect HN</title>
</svelte:head>

<h1>Bookmarks</h1>

<p class="meta">
  Bookmarks are stored in server memory via SvelteKit remote functions written
  as Effects — see <code>bookmarks.remote.ts</code>.
</p>

<!-- addBookmark is a remote form. enhance() lets us wrap the submission in
     an Effect (submitForm) and refresh the Effect-driven query afterwards. -->
<form
  class="bookmark-form"
  {...addBookmark.enhance(async ({ submit }) => {
    await Effect.runPromise(Remote.submitForm(submit));
    bookmarks.refetch();
  })}
>
  <input name="title" placeholder="Title" required />
  <input name="url" placeholder="https://… (optional)" />
  <button disabled={addBookmark.pending > 0}>
    {addBookmark.pending > 0 ? "Adding…" : "Add bookmark"}
  </button>
</form>

<!-- Success-first so the list stays on screen (with `waiting` true) while a
     refetch is in flight, instead of flashing back to the loading state. -->
{#if AsyncResult.isSuccess(bookmarksResult)}
  {#if bookmarksResult.value.length === 0}
    <p>No bookmarks yet. Add one above.</p>
  {:else}
    <ul class="bookmarks">
      {#each bookmarksResult.value as bookmark (bookmark.id)}
        <li>
          {#if bookmark.url}
            <a href={bookmark.url} rel="noreferrer">{bookmark.title}</a>
          {:else}
            <span>{bookmark.title}</span>
          {/if}
          <span class="meta">added {timeAgo(new Date(bookmark.addedAt).toISOString())}</span>
          <button
            class="subtle"
            disabled={AsyncResult.isWaiting(remove.current)}
            onclick={() => removeOne(bookmark.id)}
          >
            remove
          </button>
        </li>
      {/each}
    </ul>
  {/if}
{:else if AsyncResult.isFailure(bookmarksResult)}
  <p class="error">Could not load bookmarks.</p>
{:else}
  <p class="pending">Loading bookmarks…</p>
{/if}
