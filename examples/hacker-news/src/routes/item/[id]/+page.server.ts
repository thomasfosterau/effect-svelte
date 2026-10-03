import { error } from "@sveltejs/kit";
import { Effect } from "effect";
import { runtime } from "#lib/server/runtime.ts";
import { HackerNews } from "#lib/hn/service.ts";

/**
 * Server load using the app-wide runtime's `serverLoad` wrapper.
 *
 * The `HackerNews` service is resolved from the runtime's shared layer
 * (built once per server process, not per request). Like the standalone
 * `serverLoad` wrapper, the returned function is a real SvelteKit load, so
 * the generated $types for this route describe the data shape and
 * +page.svelte can use PageProps.
 */
export const load = runtime.serverLoad((event) =>
  Effect.gen(function* () {
    const hn = yield* HackerNews;
    const item = yield* hn.item(event.params.id as string).pipe(
      // A missing or invalid item is a 404, not a 500.
      Effect.catchTag("HackerNewsError", () => Effect.sync(() => error(404, "Item not found"))),
    );
    return { item };
  }),
);
