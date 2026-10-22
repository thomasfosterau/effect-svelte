/**
 * A stand-in for SvelteKit's `$app/navigation`, aliased in for the `client`
 * test project (see `vite.config.ts`) so `src/State.ts` and
 * `src/Navigation.ts` can be imported. `afterNavigate` (used by `State.page`)
 * records callbacks; the promise-returning functions delegate to
 * {@link navigationStubs}, which a test replaces to make one resolve or reject.
 */

import type { preloadData as kitPreloadData } from "$app/navigation";
import * as Arr from "effect/Array";

const callbacks: Array<() => void> = [];

export function afterNavigate(callback: () => void): void {
  callbacks.push(callback);
}

export function beforeNavigate(_callback: () => void): void {}

export function onNavigate(_callback: () => void): void {}

/** Fires every recorded `afterNavigate` callback. */
export function fireAfterNavigate(): void {
  Arr.forEach(callbacks, (callback) => callback());
}

/** What a stand-in resolves with: nothing, or (for `preloadData`) Kit's preload result. */
type StubResult = void | Awaited<ReturnType<typeof kitPreloadData>>;

type Stub = (...args: Array<unknown>) => Promise<StubResult>;

const defaultStubs = (): Record<
  "goto" | "invalidate" | "invalidateAll" | "refreshAll" | "preloadData" | "preloadCode",
  Stub
> => ({
  goto: () => Promise.resolve(),
  invalidate: () => Promise.resolve(),
  invalidateAll: () => Promise.resolve(),
  refreshAll: () => Promise.resolve(),
  preloadData: () => Promise.resolve({ type: "loaded", status: 200, data: {} }),
  preloadCode: () => Promise.resolve(),
});

/** The implementations behind the promise-returning stand-ins; replace one per test. */
export const navigationStubs = defaultStubs();

/** Restores every {@link navigationStubs} entry to one that resolves. */
export function resetNavigationStubs(): void {
  Object.assign(navigationStubs, defaultStubs());
}

export const goto: Stub = (...args) => navigationStubs.goto(...args);
export const invalidate: Stub = (...args) => navigationStubs.invalidate(...args);
export const invalidateAll: Stub = (...args) => navigationStubs.invalidateAll(...args);
export const refreshAll: Stub = (...args) => navigationStubs.refreshAll(...args);
export const preloadData: Stub = (...args) => navigationStubs.preloadData(...args);
export const preloadCode: Stub = (...args) => navigationStubs.preloadCode(...args);
