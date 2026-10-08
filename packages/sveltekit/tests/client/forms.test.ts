/**
 * `Forms.applyAction` against the `$app/forms` stand-in: a rejection (or a
 * synchronous throw, as Kit's server build does) lands on the error channel as
 * an `ApplyActionError` carrying the original cause, never as a defect. Then
 * `Forms.enhance` with handlers that fail: a failure reaches `onError`, or
 * rejects without it; a defect always rejects.
 */

import type { ActionResult, SubmitFunction } from "$app/forms";
import { Cause, Context, Data, Effect, Exit } from "effect";
import { afterEach, describe, expect, expectTypeOf, it } from "vite-plus/test";
import * as Forms from "../../src/forms.js";
import type { SubmitInput } from "../../src/forms.js";
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

describe("Forms.enhance with failing handlers", () => {
  class Invalid extends Data.TaggedError("Invalid")<{ readonly field: string }> {}

  /** A `SubmitFunction` input whose `cancel()` is recorded in `cancelled`. */
  const submitInput = (): { input: SubmitInput; cancelled: () => boolean } => {
    let cancelled = false;
    const input = {
      cancel: () => {
        cancelled = true;
      },
    } as SubmitInput;
    return { input, cancelled: () => cancelled };
  };

  /** Runs `submit` through both phases with `result`, as `use:enhance` would. */
  const runEnhanced = async (submit: SubmitFunction, result: ActionResult): Promise<void> => {
    const callback = await submit(submitInput().input);
    if (typeof callback !== "function") throw new Error("expected a result callback");
    await callback({ result, update: () => Promise.resolve() } as Parameters<typeof callback>[0]);
  };

  it("routes a failed applyAction returned from onResult to onError", async () => {
    const cause = new Error("navigation failed");
    formsStubs.applyAction = () => Promise.reject(cause);
    const seen: Array<unknown> = [];
    const submit = Forms.enhance(
      { onResult: ({ result }) => Forms.applyAction(result) },
      { onError: (error) => Effect.sync(() => seen.push(error)) },
    );

    await runEnhanced(submit, redirect);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(Forms.ApplyActionError);
    expect(seen[0]).toMatchObject({ _tag: "ApplyActionError", cause });
  });

  it("does not call onError when onResult succeeds or recovers", async () => {
    const seen: Array<unknown> = [];
    const onError = (error: unknown) => Effect.sync(() => seen.push(error));

    await runEnhanced(
      Forms.enhance({ onResult: ({ result }) => Forms.applyAction(result) }, { onError }),
      redirect,
    );

    formsStubs.applyAction = () => Promise.reject(new Error("navigation failed"));
    const recovered: Array<unknown> = [];
    await runEnhanced(
      Forms.enhance(
        {
          onResult: ({ result }) =>
            Forms.applyAction(result).pipe(
              Effect.catchTag("ApplyActionError", (error) =>
                Effect.sync(() => recovered.push(error)),
              ),
            ),
        },
        { onError },
      ),
      redirect,
    );

    expect(recovered).toHaveLength(1);
    expect(seen).toEqual([]);
  });

  it("rejects with the error when onResult fails and there is no onError", async () => {
    const cause = new Error("navigation failed");
    formsStubs.applyAction = () => Promise.reject(cause);
    const submit = Forms.enhance({ onResult: ({ result }) => Forms.applyAction(result) });

    await expect(runEnhanced(submit, redirect)).rejects.toSatisfy(
      (error) => error instanceof Forms.ApplyActionError && error.cause === cause,
    );
  });

  it("rejects on a defect without calling onError", async () => {
    const cause = new Error("navigation failed");
    formsStubs.applyAction = () => Promise.reject(cause);
    const seen: Array<unknown> = [];
    const submit = Forms.enhance(
      { onResult: ({ result }) => Forms.applyAction(result).pipe(Effect.orDie) },
      { onError: (error) => Effect.sync(() => seen.push(error)) },
    );

    await expect(runEnhanced(submit, redirect)).rejects.toMatchObject({
      _tag: "ApplyActionError",
      cause,
    });
    expect(seen).toEqual([]);
  });

  it("cancels the submission and calls onError when onSubmit fails", async () => {
    const seen: Array<unknown> = [];
    const submit = Forms.enhance(
      { onSubmit: () => Effect.fail(new Invalid({ field: "title" })) },
      { onError: (error) => Effect.sync(() => seen.push(error)) },
    );
    const { input, cancelled } = submitInput();

    await submit(input);
    expect(cancelled()).toBe(true);
    expect(seen).toEqual([new Invalid({ field: "title" })]);
  });

  it("rejects with the error when onSubmit fails and there is no onError", async () => {
    const submit = Forms.enhance({ onSubmit: () => Effect.fail(new Invalid({ field: "title" })) });
    const { input, cancelled } = submitInput();

    await expect(Promise.resolve(submit(input))).rejects.toBeInstanceOf(Invalid);
    expect(cancelled()).toBe(false);
  });

  it("does not cancel or call onError when onSubmit succeeds", async () => {
    const seen: Array<unknown> = [];
    const submit = Forms.enhance(
      { onSubmit: () => Effect.void },
      { onError: (error) => Effect.sync(() => seen.push(error)) },
    );
    const { input, cancelled } = submitInput();

    await submit(input);
    expect(cancelled()).toBe(false);
    expect(seen).toEqual([]);
  });

  it("runs onError on the provided runtime", async () => {
    class Reporter extends Context.Service<Reporter, { readonly report: (e: unknown) => void }>()(
      "Reporter",
    ) {}
    const reported: Array<unknown> = [];
    const runtime = Context.make(Reporter, { report: (e) => reported.push(e) });
    const submit = Forms.enhance(
      { onSubmit: () => Effect.fail(new Invalid({ field: "title" })) },
      {
        runtime,
        onError: (error) =>
          Effect.gen(function* () {
            const reporter = yield* Reporter;
            reporter.report(error);
          }),
      },
    );

    await submit(submitInput().input);
    expect(reported).toEqual([new Invalid({ field: "title" })]);
  });

  it("types onError's error as the union of the handlers' errors", () => {
    Forms.enhance(
      {
        onSubmit: () => Effect.fail(new Invalid({ field: "title" })),
        onResult: ({ result }) => Forms.applyAction(result),
      },
      {
        onError: (error) => {
          expectTypeOf(error).toEqualTypeOf<Invalid | Forms.ApplyActionError>();
          return Effect.void;
        },
      },
    );

    Forms.enhance(
      { onResult: ({ result }) => Forms.applyAction(result) },
      // @ts-expect-error: the handlers fail with ApplyActionError, not Invalid
      { onError: (error: Invalid) => Effect.log(error.field) },
    );

    Forms.enhance(
      { onResult: ({ result }) => Forms.applyAction(result) },
      // @ts-expect-error: onError must not fail
      { onError: (error) => Effect.fail(error) },
    );

    // Handlers that cannot fail leave nothing for onError to receive.
    Forms.enhance(
      { onSubmit: () => Effect.void },
      { onError: (error) => Effect.sync(() => expectTypeOf(error).toBeNever()) },
    );
  });
});
