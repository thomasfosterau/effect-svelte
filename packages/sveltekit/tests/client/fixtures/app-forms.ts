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

/** The data of a successful or failed action: a record, or absent. */
const ActionData = Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown));

/** The serialised `ActionResult` shapes, as `$app/forms` types them. */
const SerialisedActionResult = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("success"),
    status: Schema.Number,
    data: ActionData,
    location: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("failure"),
    status: Schema.Number,
    data: ActionData,
    location: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("redirect"),
    status: Schema.Number,
    location: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("error"),
    status: Schema.optionalKey(Schema.Number),
    error: Schema.Struct({ message: Schema.String, status: Schema.Number }),
    location: Schema.optionalKey(Schema.String),
  }),
]);

const decodeActionResult = Schema.decodeUnknownSync(Schema.fromJsonString(SerialisedActionResult));

/**
 * Parses a JSON body as an `ActionResult`. Unlike Kit's own `deserialize`,
 * which trusts the body, it throws for JSON of any other shape.
 */
export function deserialize(result: string): ActionResult {
  return decodeActionResult(result);
}

export function enhance(): void {}
