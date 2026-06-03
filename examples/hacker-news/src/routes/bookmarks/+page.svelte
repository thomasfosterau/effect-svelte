<script lang="ts">
  import { Effect } from "effect";
  import {
    isFailure,
    isPending,
    isSuccess,
    useEffect,
    useQuery,
  } from "@thomasfosterau/effect-svelte";
  import {
    callCommandWithUpdates,
    callQuery,
    submitForm,
  } from "@thomasfosterau/effect-svelte/kit";
  import { timeAgo } from "$lib/format";
  import { addBookmark, getBookmarks, removeBookmark } from "./bookmarks.remote";

  // -- Reading -------------------------------------------------------------
  // callQuery wraps the SvelteKit remote query in an Effect; useQuery runs it
  // through the client-side Effect runtime and exposes an AsyncResult.
  const bookmarks = useQuery(callQuery(getBookmarks));

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
      return callCommandWithUpdates(removeBookmark, id, getBookmarks()).pipe(
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
    await Effect.runPromise(submitForm(submit));
    bookmarks.refetch();
  })}
>
  <input name="title" placeholder="Title" required />
  <input name="url" placeholder="https://… (optional)" />
  <button disabled={addBookmark.pending > 0}>
    {addBookmark.pending > 0 ? "Adding…" : "Add bookmark"}
  </button>
</form>

{#if isPending(bookmarks.result)}
  <p class="pending">Loading bookmarks…</p>
{:else if isFailure(bookmarks.result)}
  <p class="error">Could not load bookmarks.</p>
{:else if isSuccess(bookmarks.result)}
  {#if bookmarks.result.value.length === 0}
    <p>No bookmarks yet. Add one above.</p>
  {:else}
    <ul class="bookmarks">
      {#each bookmarks.result.value as bookmark (bookmark.id)}
        <li>
          {#if bookmark.url}
            <a href={bookmark.url} rel="noreferrer">{bookmark.title}</a>
          {:else}
            <span>{bookmark.title}</span>
          {/if}
          <span class="meta">added {timeAgo(new Date(bookmark.addedAt).toISOString())}</span>
          <button
            class="subtle"
            disabled={isPending(remove.result)}
            onclick={() => removeOne(bookmark.id)}
          >
            remove
          </button>
        </li>
      {/each}
    </ul>
  {/if}
{/if}
