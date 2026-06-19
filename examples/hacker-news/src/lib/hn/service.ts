import { Config, Context, Effect, Layer, Schema } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { STORIES_PER_PAGE, type ListKind } from "./lists";
import { Item, StoryPage, User } from "./schema";

/** Error raised when the Hacker News API call fails. */
export class HackerNewsError extends Schema.TaggedErrorClass<HackerNewsError>()("HackerNewsError", {
  message: Schema.String,
}) {}

/**
 * Hacker News API client, backed by the Algolia HN API.
 *
 * The service only requires `HttpClient`, which the effect-sveltekit
 * runtime provides on the server — and on the client for universal loads —
 * via the SvelteKit `fetch` of the current request/navigation.
 *
 * The API base URL can be overridden with the `HN_API_BASE` environment
 * variable (read through Effect's Config system), e.g. to point at a mock
 * server in tests.
 */
export class HackerNews extends Context.Service<HackerNews>()("examples/HackerNews", {
  make: Effect.gen(function* () {
    const API = yield* Config.string("HN_API_BASE").pipe(
      Config.withDefault("https://hn.algolia.com/api/v1"),
    );

    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);

    const getJson = <A, I>(url: string, schema: Schema.Codec<A, I>) =>
      client.get(url).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
        Effect.mapError((error) => new HackerNewsError({ message: String(error) })),
      );

    const list = (kind: ListKind, page: number) => {
      const params = `page=${page - 1}&hitsPerPage=${STORIES_PER_PAGE}`;
      const url =
        kind === "new"
          ? `${API}/search_by_date?tags=story&${params}`
          : kind === "top"
            ? `${API}/search?tags=front_page&${params}`
            : `${API}/search?tags=${kind}_hn&${params}`;
      return getJson(url, StoryPage);
    };

    return {
      /** A page of one of the story lists (top/new/ask/show). Pages start at 1. */
      list,

      /** A single item with its full comment tree. */
      item: (id: string) => getJson(`${API}/items/${id}`, Item),

      /** A user profile. */
      user: (username: string) => getJson(`${API}/users/${encodeURIComponent(username)}`, User),

      /** Full-text story search. Pages start at 1. */
      search: (query: string, page: number) =>
        getJson(
          `${API}/search?query=${encodeURIComponent(query)}&tags=story&page=${page - 1}&hitsPerPage=${STORIES_PER_PAGE}`,
          StoryPage,
        ),
    } as const;
  }),
}) {
  /** Layer that builds the service from its `make` effect. */
  static readonly layer = Layer.effect(this, this.make);
}
