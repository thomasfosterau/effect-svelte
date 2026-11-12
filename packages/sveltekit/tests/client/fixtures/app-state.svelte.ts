/**
 * A rune-backed stand-in for SvelteKit's `$app/state`, aliased in for the
 * `client` test project (see `vite.config.ts`). It mirrors the structure of
 * Kit 3's `src/runtime/app/state/client.svelte.js` — `$state.raw` fields behind
 * getter objects — plus setters the tests drive. The shapes are SvelteKit's
 * own (`null` where `$app/state` has `null`), typed from its `Page` and
 * `navigating`.
 */

import type { Page, navigating as kitNavigating } from "$app/state";

class FakePage implements Page {
  data = $state.raw<Page["data"]>({});
  form = $state.raw<Page["form"]>(null);
  error = $state.raw<Page["error"]>(null);
  params = $state.raw<Page["params"]>({});
  route = $state.raw<Page["route"]>({ id: null });
  shallow = $state.raw<Page["shallow"]>(null);
  state = $state.raw<Page["state"]>({});
  status = $state.raw(-1);
  url = $state.raw<Page["url"]>(new URL("https://example.com/"));
}

const internalPage = new FakePage();

/** Assigns `fields` onto the page, as Kit's `update_page` does. */
export function setPage(fields: Partial<Page>): void {
  Object.assign(internalPage, fields);
}

export const page: Page = {
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

/** `$app/state`'s `navigating`, as SvelteKit types it. */
type Navigating = typeof kitNavigating;

/** `navigating` while no navigation is in flight: every field is `null`. */
const idle: Navigating = {
  from: null,
  to: null,
  type: null,
  willUnload: null,
  delta: null,
  complete: null,
};

let navigation = $state.raw<Navigating>(idle);
let navigatingTypeReads = 0;

/** How many times `navigating.type` has been read — i.e. watcher runs. */
export function navigatingReads(): number {
  return navigatingTypeReads;
}

/** Sets the in-flight navigation. */
export function setNavigation(value: Navigating): void {
  navigation = value;
}

/** Clears the in-flight navigation: `navigating`'s fields are `null` again. */
export function clearNavigation(): void {
  navigation = idle;
}

export const navigating = {
  get from() {
    return navigation.from;
  },
  get to() {
    return navigation.to;
  },
  get type() {
    navigatingTypeReads += 1;
    return navigation.type;
  },
  get willUnload() {
    return navigation.willUnload;
  },
  get delta() {
    return navigation.type === "popstate" ? navigation.delta : null;
  },
  get complete() {
    return navigation.complete;
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
