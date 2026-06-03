import { Effect, Schema } from "effect";
import { RemoteFunction } from "@thomasfosterau/effect-svelte/kit/server";
import { Bookmarks } from "$lib/server/bookmarks";

/**
 * SvelteKit remote functions
 * (https://svelte.dev/docs/kit/remote-functions) written as Effects via
 * `RemoteFunction`. Requires `kit.experimental.remoteFunctions: true` in
 * svelte.config.js.
 *
 * Effect Schema doubles as the Standard Schema validator for inputs via
 * `Schema.toStandardSchemaV1`.
 */

const withStore = Effect.provide(Bookmarks.layer);

/** Remote query: returns all bookmarks. */
export const getBookmarks = RemoteFunction.query(() =>
  Effect.flatMap(Bookmarks, (store) => store.all).pipe(withStore),
);

/** Remote form: add a bookmark from a <form> submission. */
export const addBookmark = RemoteFunction.form(
  Schema.toStandardSchemaV1(
    Schema.Struct({
      title: Schema.Trimmed.check(Schema.isNonEmpty()),
      url: Schema.String,
    }),
  ),
  (data) =>
    Effect.flatMap(Bookmarks, (store) =>
      store.add({ title: data.title, url: data.url.trim() === "" ? null : data.url }),
    ).pipe(withStore),
);

/** Remote command: remove a bookmark by id. */
export const removeBookmark = RemoteFunction.command(
  Schema.toStandardSchemaV1(Schema.String),
  (id) =>
    Effect.gen(function* () {
      const store = yield* Bookmarks;
      const deleted = yield* store.remove(id);
      // Single-flight mutation: refresh the bookmarks query inside the command
      // so its new value ships back in the same response and updates the
      // client's cached query instance.
      yield* Effect.promise(() => getBookmarks().refresh());
      return deleted;
    }).pipe(withStore),
);
