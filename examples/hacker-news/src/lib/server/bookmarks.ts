import { Effect, Schema } from "effect";

/**
 * A bookmark, kept as a plain struct so it can be serialized by SvelteKit's
 * remote functions.
 */
export const Bookmark = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  url: Schema.NullOr(Schema.String),
  addedAt: Schema.Number,
});
export type Bookmark = typeof Bookmark.Type;

// Module-level storage: survives across requests within a server process.
// A real app would put this behind a database layer.
const store = new Map<string, Bookmark>();

/** In-memory bookmark store, exposed as an Effect service. */
export class Bookmarks extends Effect.Service<Bookmarks>()("examples/Bookmarks", {
  sync: () => ({
    all: Effect.sync(() => [...store.values()].sort((a, b) => b.addedAt - a.addedAt)),

    add: (input: { readonly title: string; readonly url: string | null }) =>
      Effect.sync(() => {
        const bookmark: Bookmark = {
          id: crypto.randomUUID(),
          title: input.title,
          url: input.url,
          addedAt: Date.now(),
        };
        store.set(bookmark.id, bookmark);
        return bookmark;
      }),

    remove: (id: string) => Effect.sync(() => store.delete(id)),
  }),
}) {}
