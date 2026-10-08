/**
 * A rune-backed stand-in for SvelteKit's `$app/state`, aliased in for the
 * `client` test project (see `vite.config.ts`). It mirrors the structure of
 * Kit 3's `src/runtime/app/state/client.svelte.js` — `$state.raw` fields behind
 * getter objects — plus setters the tests drive.
 */

import type { Navigation } from "$app/navigation";

class FakePage {
  data = $state.raw<Record<string, unknown>>({});
  form = $state.raw<unknown>(null);
  error = $state.raw<unknown>(null);
  params = $state.raw<Record<string, string>>({});
  route = $state.raw<{ id: string | null }>({ id: null });
  shallow = $state.raw<unknown>(null);
  state = $state.raw<unknown>({});
  status = $state.raw(-1);
  url = $state.raw(new URL("https://example.com/"));
}

const internalPage = new FakePage();

/** Assigns `fields` onto the page, as Kit's `update_page` does. */
export function setPage(fields: Partial<FakePage>): void {
  Object.assign(internalPage, fields);
}

export const page = {
  get data() {
    return internalPage.data;
  },
  get error() {
    return internalPage.error;
  },
  get form() {
    return internalPage.form;
  },
  get params() {
    return internalPage.params;
  },
  get route() {
    return internalPage.route;
  },
  get shallow() {
    return internalPage.shallow;
  },
  get state() {
    return internalPage.state;
  },
  get status() {
    return internalPage.status;
  },
  get url() {
    return internalPage.url;
  },
};

let navigation = $state.raw<Navigation | null>(null);
let navigatingTypeReads = 0;

/** How many times `navigating.type` has been read — i.e. watcher runs. */
export function navigatingReads(): number {
  return navigatingTypeReads;
}

/** Sets (or clears, with `null`) the in-flight navigation. */
export function setNavigation(value: Navigation | null): void {
  navigation = value;
}

export const navigating = {
  get from() {
    return navigation ? navigation.from : null;
  },
  get to() {
    return navigation ? navigation.to : null;
  },
  get type() {
    navigatingTypeReads += 1;
    return navigation ? navigation.type : null;
  },
  get willUnload() {
    return navigation ? navigation.willUnload : null;
  },
  get delta() {
    return navigation?.type === "popstate" ? navigation.delta : null;
  },
  get complete() {
    return navigation ? navigation.complete : null;
  },
};

let isUpdated = $state(false);
let check: () => Promise<boolean> = () => Promise.resolve(isUpdated);

/** Sets `updated.current`. */
export function setUpdated(value: boolean): void {
  isUpdated = value;
}

/** Replaces the implementation behind `updated.check()`. */
export function setCheck(impl: () => Promise<boolean>): void {
  check = impl;
}

export const updated = {
  get current() {
    return isUpdated;
  },
  check: () => check(),
};
