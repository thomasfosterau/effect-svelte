import { redirect } from "@sveltejs/kit";

/**
 * A plain (non-Effect) load function: the effectKit() Vite plugin detects
 * that it neither is nor returns an Effect, and passes it through to
 * SvelteKit unchanged.
 */
export const load = () => {
  redirect(307, "/top/1");
};
