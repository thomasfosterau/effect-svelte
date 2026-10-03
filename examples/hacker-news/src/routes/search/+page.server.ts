import { fail } from "@sveltejs/kit";
import { Effect } from "effect";
import { runtime } from "#lib/server/runtime.ts";
import { HackerNews } from "#lib/hn/service.ts";

/**
 * Form actions using the app-wide runtime's `actions` wrapper. Each entry is
 * a function from the request event to an Effect, with the application's
 * services (HackerNews) resolved from the shared layer.
 */
export const actions = runtime.actions({
  search: (event) =>
    Effect.gen(function* () {
      const form = yield* Effect.promise(() => event.request.formData());
      const rawQuery = form.get("query");
      const query = typeof rawQuery === "string" ? rawQuery.trim() : "";

      if (query.length === 0) {
        // `fail(...)` is returned (not thrown): it becomes the action's
        // result and shows up as `form` in +page.svelte.
        return fail(400, { query, message: "Enter a search term." });
      }

      const hn = yield* HackerNews;
      const results = yield* hn.search(query, 1);
      return { query, results };
    }),
});
