/**
 * Stand-in for SvelteKit's `$app/state` in the smoke test: the layout reads
 * only `page.url` (to highlight the active nav link).
 */
export const page = {
  url: new URL("http://localhost/bookmarks"),
};
