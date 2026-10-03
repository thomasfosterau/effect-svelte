import { error, json } from "@sveltejs/kit";
import { Effect } from "effect";
import { runtime } from "#lib/server/runtime.ts";
import { isListKind } from "#lib/hn/lists.ts";
import { HackerNews } from "#lib/hn/service.ts";

/**
 * A JSON API endpoint using the app-wide runtime's `endpoint` wrapper:
 * `HackerNews` is resolved from the shared application layer.
 *
 * Try it: GET /api/top
 */
export const GET = runtime.endpoint((event) =>
  Effect.gen(function* () {
    const list = event.params.list as string;
    if (!isListKind(list)) {
      // error() inside an Effect is passed through to SvelteKit.
      return yield* Effect.sync(() => error(404, "Unknown list"));
    }

    const hn = yield* HackerNews;
    const stories = yield* hn.list(list, 1);
    return json(stories);
  }),
);
