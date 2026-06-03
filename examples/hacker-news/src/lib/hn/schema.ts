import { Schema } from "effect";

/**
 * Schemas for the Algolia Hacker News API (https://hn.algolia.com/api).
 *
 * These are `Schema.Struct`s (not classes) so the decoded values are plain
 * objects, which SvelteKit can serialize when they are returned from server
 * `load` functions and form actions.
 */

/** A story hit from the search endpoints. */
export const Story = Schema.Struct({
  objectID: Schema.String,
  title: Schema.NullishOr(Schema.String),
  url: Schema.NullishOr(Schema.String),
  author: Schema.NullishOr(Schema.String),
  points: Schema.NullishOr(Schema.Number),
  num_comments: Schema.NullishOr(Schema.Number),
  created_at: Schema.String,
});
export type Story = typeof Story.Type;

/** A page of stories from the search endpoints. */
export const StoryPage = Schema.Struct({
  hits: Schema.Array(Story),
  page: Schema.Number,
  nbPages: Schema.Number,
  nbHits: Schema.Number,
});
export type StoryPage = typeof StoryPage.Type;

/** A comment in an item's tree (recursive). */
export interface Comment {
  readonly id: number;
  readonly author: string | null;
  readonly text: string | null;
  readonly created_at: string;
  readonly children: ReadonlyArray<Comment>;
}

export const Comment: Schema.Schema<Comment> = Schema.Struct({
  id: Schema.Number,
  author: Schema.NullOr(Schema.String),
  text: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  children: Schema.Array(Schema.suspend((): Schema.Schema<Comment> => Comment)),
});

/** A full item (story plus comment tree) from the items endpoint. */
export const Item = Schema.Struct({
  id: Schema.Number,
  title: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  text: Schema.NullOr(Schema.String),
  author: Schema.NullOr(Schema.String),
  points: Schema.NullOr(Schema.Number),
  created_at: Schema.String,
  children: Schema.Array(Comment),
});
export type Item = typeof Item.Type;

/** A user profile from the users endpoint. */
export const User = Schema.Struct({
  username: Schema.String,
  about: Schema.NullishOr(Schema.String),
  karma: Schema.Number,
  created_at: Schema.String,
});
export type User = typeof User.Type;
