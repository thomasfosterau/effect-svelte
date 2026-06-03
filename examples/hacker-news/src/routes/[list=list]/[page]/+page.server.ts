import { error } from "@sveltejs/kit";
import { Effect } from "effect";
import { SvelteKitRequestEvent } from "@thomasfosterau/effect-svelte/kit/server";
import { isListKind } from "$lib/hn/lists";
import { HackerNews } from "$lib/hn/service";

/**
 * Server load written as a bare Effect — no function, no wrapper.
 *
 * The effectKit() Vite plugin rewrites this export to run through the
 * SvelteKit Effect runtime. The current request is read from the
 * `SvelteKitRequestEvent` service instead of a parameter.
 *
 * Note: because the export is an Effect rather than a function, SvelteKit's
 * generated $types cannot infer the data shape — +page.svelte types its
 * `data` prop manually.
 */
export const load = Effect.gen(function* () {
  const event = yield* SvelteKitRequestEvent;
  const { list, page } = event.params as { list: string; page: string };

  const pageNumber = Number.parseInt(page, 10);
  if (!isListKind(list) || Number.isNaN(pageNumber) || pageNumber < 1) {
    return yield* Effect.sync(() => error(404, "Not found"));
  }

  const hn = yield* HackerNews;
  const stories = yield* hn.list(list, pageNumber);

  return { list, page: pageNumber, stories };
}).pipe(Effect.provide(HackerNews.Default));
