import { error, json } from "@sveltejs/kit";
import { Effect } from "effect";
import { endpoint } from "@thomasfosterau/effect-svelte/kit/server";
import { isListKind } from "$lib/hn/lists";
import { HackerNews } from "$lib/hn/service";

/**
 * A JSON API endpoint using the explicit `endpoint` wrapper.
 *
 * Try it: GET /api/top
 */
export const GET = endpoint((event) =>
  Effect.gen(function* () {
    const list = event.params.list as string;
    if (!isListKind(list)) {
      // error() inside an Effect is passed through to SvelteKit.
      return yield* Effect.sync(() => error(404, "Unknown list"));
    }

    const hn = yield* HackerNews;
    const stories = yield* hn.list(list, 1);
    return json(stories);
  }).pipe(Effect.provide(HackerNews.Default)),
);
