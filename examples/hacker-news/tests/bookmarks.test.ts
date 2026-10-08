/**
 * Runtime smoke test (#136): mounts the /bookmarks route (root layout plus
 * page) in happy-dom and fails on an uncaught error, a Svelte runtime error,
 * or a query that keeps re-running itself (`useQuery` looped before #133).
 *
 * The page's remote functions are replaced with in-memory stubs of the same
 * shape SvelteKit's client proxies have, so the test needs no server and no
 * network.
 */
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Bookmark } from "../src/lib/server/bookmarks";
import Bookmarks from "./Bookmarks.svelte";
import { captureErrors, settle } from "./smoke";

const remote = vi.hoisted(() => {
  const store = new Map<string, Bookmark>();
  return {
    store,
    getBookmarks: vi.fn(() => Promise.resolve([...store.values()])),
    removeBookmark: vi.fn((id: string) => ({
      updates: () => Promise.resolve(store.delete(id)),
    })),
  };
});

// Only the members the page uses: `getBookmarks()` resolves like a remote
// query, `removeBookmark(id).updates(...)` like a command, and `addBookmark`
// has the remote form's `enhance()` / `pending`.
vi.mock("../src/routes/bookmarks/bookmarks.remote", () => ({
  getBookmarks: remote.getBookmarks,
  removeBookmark: remote.removeBookmark,
  addBookmark: { enhance: () => ({ method: "POST", action: "" }), pending: 0 },
}));

let errors: ReturnType<typeof captureErrors>;
let target: HTMLElement;
let app: Record<string, unknown> | undefined;

beforeEach(() => {
  remote.store.clear();
  for (const bookmark of [
    { id: "a", title: "Effect", url: "https://effect.website", addedAt: Date.now() },
    { id: "b", title: "Svelte", url: null, addedAt: Date.now() },
  ]) {
    remote.store.set(bookmark.id, bookmark);
  }
  errors = captureErrors();
  target = document.body.appendChild(document.createElement("div"));
});

afterEach(async () => {
  if (app) await unmount(app);
  app = undefined;
  target.remove();
  errors.dispose();
  vi.clearAllMocks();
});

const titles = () =>
  [...target.querySelectorAll(".bookmarks li")].map(
    (item) => item.querySelector("a, span")?.textContent,
  );

describe("/bookmarks", () => {
  it("loads the bookmarks once and refetches once after a removal", async () => {
    app = mount(Bookmarks, { target });
    flushSync();

    await vi.waitFor(() => expect(titles()).toEqual(["Effect", "Svelte"]));
    await settle();

    expect(target.querySelector("a.active")?.textContent).toBe("Bookmarks");
    // `useQuery` ran the remote query once, and nothing re-ran it.
    expect(remote.getBookmarks).toHaveBeenCalledTimes(1);

    // Remove one: the command is called once, and the page refetches once
    // (the command's single-flight `updates` argument is a second call).
    target.querySelector<HTMLButtonElement>(".bookmarks li button")!.click();

    await vi.waitFor(() => expect(titles()).toEqual(["Svelte"]));
    await settle();

    expect(remote.removeBookmark.mock.calls).toEqual([["a"]]);
    expect(remote.getBookmarks).toHaveBeenCalledTimes(3);

    expect(errors.errors).toEqual([]);
  });
});
