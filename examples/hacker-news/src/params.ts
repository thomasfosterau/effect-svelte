import { defineParams } from "@sveltejs/kit/params";
import { isListKind } from "#lib/hn/lists.ts";

/**
 * Route param matchers (SvelteKit 3 reads them all from this one file).
 *
 * `list` matches the story list kinds: /top, /new, /ask, /show.
 */
export const params = defineParams({
  list: (param) => (isListKind(param) ? param : undefined),
});
