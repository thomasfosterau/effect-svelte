import { error } from "@sveltejs/kit";
import { Effect } from "effect";
import { load as effectLoad } from "@thomasfosterau/effect-sveltekit";
import { HackerNews } from "$lib/hn/service";

/**
 * Universal load using the explicit `load` wrapper.
 *
 * It runs on the server for the first page view and on the client during
 * navigation. `HttpClient` is available in both environments: on the server
 * it is backed by the request's fetch, on the client by the load event's
 * fetch.
 */
export const load = effectLoad((event) =>
  Effect.gen(function* () {
    const hn = yield* HackerNews;
    const user = yield* hn
      .user(event.params.name as string)
      .pipe(
        Effect.catchTag("HackerNewsError", () => Effect.sync(() => error(404, "User not found"))),
      );
    return { user };
  }).pipe(Effect.provide(HackerNews.layer)),
);
