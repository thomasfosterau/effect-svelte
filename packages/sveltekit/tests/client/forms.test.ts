/**
 * `Forms.applyAction` against the `$app/forms` stand-in: a rejection (or a
 * synchronous throw, as Kit's server build does) lands on the error channel as
 * an `ApplyActionError` carrying the original cause, never as a defect.
 */

import type { ActionResult } from "$app/forms";
import { Cause, Effect, Exit } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import * as Forms from "../../src/forms.js";
import { formsStubs, resetFormsStubs } from "./fixtures/app-forms.js";

afterEach(resetFormsStubs);

/**
 * Runs `effect` and returns the single error it failed with on the error
 * channel (a `Fail` reason), asserting it did not die.
 */
const failureOf = async (effect: Effect.Effect<unknown, unknown, never>): Promise<unknown> => {
  const exit = await Effect.runPromise(Effect.exit(effect));
  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) return undefined;
  expect(Cause.hasDies(exit.cause)).toBe(false);
  expect(exit.cause.reasons).toHaveLength(1);
  const [reason] = exit.cause.reasons;
  expect(reason !== undefined && Cause.isFailReason(reason)).toBe(true);
  return reason !== undefined && Cause.isFailReason(reason) ? reason.error : undefined;
};

const redirect: ActionResult = { type: "redirect", status: 303, location: "/done" };

describe("Forms.applyAction", () => {
  it("passes the result to SvelteKit and succeeds", async () => {
    const calls: Array<unknown> = [];
    formsStubs.applyAction = (result) => {
      calls.push(result);
      return Promise.resolve();
    };

    await Effect.runPromise(Forms.applyAction(redirect));
    expect(calls).toEqual([redirect]);
  });

  it("fails with an ApplyActionError carrying the rejection", async () => {
    const cause = new Error("https://svelte.dev/e/kit/navigation_route_missing");
    formsStubs.applyAction = () => Promise.reject(cause);

    const error = await failureOf(Forms.applyAction(redirect));
    expect(error).toMatchObject({ _tag: "ApplyActionError", cause });
  });

  it("fails with an ApplyActionError when SvelteKit throws synchronously", async () => {
    // Kit's server build throws synchronously (`server_api_unavailable`).
    const cause = new Error("Cannot call applyAction(...) on the server");
    formsStubs.applyAction = () => {
      throw cause;
    };

    const error = await failureOf(Forms.applyAction(redirect));
    expect(error).toMatchObject({ _tag: "ApplyActionError", cause });
  });

  it("is an ApplyActionError instance that Effect.catchTag recovers from", async () => {
    const cause = new Error("chunk failed to load");
    formsStubs.applyAction = () => Promise.reject(cause);

    const error = await failureOf(Forms.applyAction(redirect));
    expect(error).toBeInstanceOf(Forms.ApplyActionError);

    const recovered = await Effect.runPromise(
      Forms.applyAction(redirect).pipe(
        Effect.as("applied"),
        Effect.catchTag("ApplyActionError", (e) => Effect.succeed(e.cause)),
      ),
    );
    expect(recovered).toBe(cause);
  });
});
