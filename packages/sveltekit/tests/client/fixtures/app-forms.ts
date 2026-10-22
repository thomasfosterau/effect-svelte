/**
 * A stand-in for SvelteKit's `$app/forms`, aliased in for the `client` test
 * project (see `vite.config.ts`) so `src/forms.ts` can be imported.
 * `applyAction` delegates to {@link formsStubs}, which a test replaces to make
 * it resolve or reject; `deserialize` parses JSON, like Kit's.
 */

import type { ActionResult } from "$app/forms";
import * as Schema from "effect/Schema";

type ApplyAction = (result: ActionResult) => Promise<void>;

interface FormsStubs {
  applyAction: ApplyAction;
}

const defaultStubs = (): FormsStubs => ({
  applyAction: () => Promise.resolve(),
});

/** The implementations behind the promise-returning stand-ins; replace one per test. */
export const formsStubs = defaultStubs();

/** Restores every {@link formsStubs} entry to one that resolves. */
export function resetFormsStubs(): void {
  Object.assign(formsStubs, defaultStubs());
}

export const applyAction: ApplyAction = (result) => formsStubs.applyAction(result);

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

export function deserialize(result: string): ActionResult {
  // SAFETY: like Kit's own `deserialize`, this stand-in trusts the body to be a
  // serialised `ActionResult` and does not validate its shape.
  return decodeJson(result) as ActionResult;
}

export function enhance(): void {}
