/**
 * A stand-in for SvelteKit's `$app/navigation`, aliased in for the `client`
 * test project (see `vite.config.ts`) so `src/State.ts` can be imported. Only
 * `afterNavigate` (used by `State.page`) is provided; it records callbacks.
 */

const callbacks: Array<() => void> = [];

export function afterNavigate(callback: () => void): void {
  callbacks.push(callback);
}

/** Fires every recorded `afterNavigate` callback. */
export function fireAfterNavigate(): void {
  for (const callback of callbacks) callback();
}
