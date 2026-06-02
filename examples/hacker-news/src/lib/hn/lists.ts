/**
 * Story list kinds and pagination constants.
 *
 * Kept in their own module (with no Effect/platform imports) so client
 * components can import them without pulling server-oriented dependencies
 * into the bundle.
 */

export type ListKind = "top" | "new" | "ask" | "show";

export const LIST_KINDS: ReadonlyArray<ListKind> = ["top", "new", "ask", "show"];

export const isListKind = (value: string): value is ListKind =>
  (LIST_KINDS as ReadonlyArray<string>).includes(value);

export const STORIES_PER_PAGE = 30;

export const LIST_TITLES: Record<ListKind, string> = {
  top: "Top",
  new: "New",
  ask: "Ask HN",
  show: "Show HN",
};
