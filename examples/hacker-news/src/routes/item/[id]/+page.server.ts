import { error } from "@sveltejs/kit";
import { Effect } from "effect";
import { serverLoad } from "@thomasfosterau/effect-svelte/kit/server";
import { HackerNews } from "$lib/hn/service";

/**
 * Server load using the explicit `serverLoad` wrapper.
 *
 * Compared to the plugin-rewritten form (see /[list]/[page]), the explicit
 * wrapper returns a real SvelteKit load function, so the generated $types
 * for this route describe the data shape and +page.svelte can use PageProps.
 */
export const load = serverLoad((event) =>
  Effect.gen(function* () {
    const hn = yield* HackerNews;
    const item = yield* hn.item(event.params.id as string).pipe(
      // A missing or invalid item is a 404, not a 500.
      Effect.catchTag("HackerNewsError", () => Effect.sync(() => error(404, "Item not found"))),
    );
    return { item };
  }).pipe(Effect.provide(HackerNews.Default)),
);
