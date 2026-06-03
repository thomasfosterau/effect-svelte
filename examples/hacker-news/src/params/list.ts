import type { ParamMatcher } from "@sveltejs/kit";

/** Matches the story list kinds: /top, /new, /ask, /show */
export const match: ParamMatcher = (param) => ["top", "new", "ask", "show"].includes(param);
