/**
 * A stand-in for SvelteKit's `$app/forms`, aliased in for the `client` test
 * project (see `vite.config.ts`) so `src/forms.ts` can be imported.
 * `applyAction` delegates to {@link formsStubs}, which a test replaces to make
 * it resolve or reject; `deserialize` parses JSON, like Kit's.
 */

type Stub = (...args: Array<unknown>) => Promise<unknown>;

const defaultStubs = (): Record<"applyAction", Stub> => ({
  applyAction: () => Promise.resolve(),
});

/** The implementations behind the promise-returning stand-ins; replace one per test. */
export const formsStubs = defaultStubs();

/** Restores every {@link formsStubs} entry to one that resolves. */
export function resetFormsStubs(): void {
  Object.assign(formsStubs, defaultStubs());
}

export const applyAction: Stub = (...args) => formsStubs.applyAction(...args);

export function deserialize(result: string): unknown {
  return JSON.parse(result);
}

export function enhance(): void {}
