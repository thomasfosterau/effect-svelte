/**
 * `Forms.applyAction` against the `$app/forms` stand-in: a rejection (or a
 * synchronous throw, as Kit's server build does) lands on the error channel as
 * an `ApplyActionError` carrying the original cause, never as a defect. Then
 * `Forms.enhance` with handlers that fail: a failure reaches `onError`, or
 * rejects without it; a defect always rejects.
 */

import type { ActionResult, SubmitFunction } from "$app/forms";
import { Cause, Context, Data, Effect, Exit, Layer, ManagedRuntime } from "effect";
import { afterEach, describe, expect, expectTypeOf, it } from "vite-plus/test";
import * as Forms from "../../src/forms.js";
import type {
  EnhanceHandlers,
  EnhanceOptions,
  EnhanceOptionsArgs,
  EnhanceRuntime,
  SubmitInput,
} from "../../src/forms.js";
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
const success: ActionResult = { type: "success", status: 200, location: "/" };

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

  /**
   * Runs `submit` through both phases with `result`, as `use:enhance` would,
   * resolving with how many times the result callback called SvelteKit's
   * `update()`.
   */
  const runEnhanced = async (submit: SubmitFunction, result: ActionResult): Promise<number> => {
    const callback = await submit(submitInput().input);
    if (typeof callback !== "function") throw new Error("expected a result callback");
    let updates = 0;
    const update = () => {
      updates++;
      return Promise.resolve();
    };
    await callback({ result, update } as Parameters<typeof callback>[0]);
    return updates;
  };

  it("routes a failed applyAction returned from onResult to onError", async () => {
    const cause = new Error("navigation failed");
    formsStubs.applyAction = () => Promise.reject(cause);
    const seen: Array<unknown> = [];
    const submit = Forms.enhance({
      onResult: ({ result }) => Forms.applyAction(result),
      onError: (error) => Effect.sync(() => seen.push(error)),
    });

    // onError replaces SvelteKit's default result behaviour: `update()` is not
    // called in its place.
    expect(await runEnhanced(submit, redirect)).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(Forms.ApplyActionError);
    expect(seen[0]).toMatchObject({ _tag: "ApplyActionError", cause });
  });

  it("calls update() only when a successful onResult calls it", async () => {
    const seen: Array<unknown> = [];
    const submit = Forms.enhance({
      onResult: ({ update }) => Effect.promise(() => update()),
      onError: (error) => Effect.sync(() => seen.push(error)),
    });

    expect(await runEnhanced(submit, success)).toBe(1);
    expect(seen).toEqual([]);
  });

  it("does not call onError when onResult succeeds or recovers", async () => {
    const seen: Array<unknown> = [];
    const onError = (error: unknown) => Effect.sync(() => seen.push(error));

    await runEnhanced(
      Forms.enhance({ onResult: ({ result }) => Forms.applyAction(result), onError }),
      redirect,
    );

    formsStubs.applyAction = () => Promise.reject(new Error("navigation failed"));
    const recovered: Array<unknown> = [];
    await runEnhanced(
      Forms.enhance({
        onResult: ({ result }) =>
          Forms.applyAction(result).pipe(
            Effect.catchTag("ApplyActionError", (error) =>
              Effect.sync(() => recovered.push(error)),
            ),
          ),
        onError,
      }),
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
    const submit = Forms.enhance({
      onResult: ({ result }) => Forms.applyAction(result).pipe(Effect.orDie),
      onError: (error) => Effect.sync(() => seen.push(error)),
    });

    await expect(runEnhanced(submit, redirect)).rejects.toMatchObject({
      _tag: "ApplyActionError",
      cause,
    });
    expect(seen).toEqual([]);
  });

  it("cancels the submission and calls onError when onSubmit fails", async () => {
    const seen: Array<unknown> = [];
    const submit = Forms.enhance({
      onSubmit: () => Effect.fail(new Invalid({ field: "title" })),
      onError: (error) => Effect.sync(() => seen.push(error)),
    });
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
    const submit = Forms.enhance({
      onSubmit: () => Effect.void,
      onError: (error) => Effect.sync(() => seen.push(error)),
    });
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
      {
        onSubmit: () => Effect.fail(new Invalid({ field: "title" })),
        onError: (error) =>
          Effect.gen(function* () {
            const reporter = yield* Reporter;
            reporter.report(error);
          }),
      },
      { runtime },
    );

    await submit(submitInput().input);
    expect(reported).toEqual([new Invalid({ field: "title" })]);
  });

  it("types onError's error as the union of the handlers' errors, after them", () => {
    Forms.enhance({
      onSubmit: () => Effect.fail(new Invalid({ field: "title" })),
      onResult: ({ result }) => Forms.applyAction(result),
      onError: (error) => {
        expectTypeOf(error).toEqualTypeOf<Invalid | Forms.ApplyActionError>();
        return Effect.void;
      },
    });

    Forms.enhance({
      onResult: ({ result }) => Forms.applyAction(result),
      onError: (error) => {
        expectTypeOf(error).toEqualTypeOf<Forms.ApplyActionError>();
        return Effect.void;
      },
    });

    Forms.enhance({
      onSubmit: ({ action }) => Effect.fail(new Invalid({ field: action.pathname })),
      onError: (error) => {
        expectTypeOf(error).toEqualTypeOf<Invalid>();
        return Effect.void;
      },
    });

    // Handlers that cannot fail leave nothing for onError to receive.
    Forms.enhance({
      onSubmit: () => Effect.void,
      onError: (error) => Effect.sync(() => expectTypeOf(error).toBeNever()),
    });
    Forms.enhance({ onError: (error) => Effect.sync(() => expectTypeOf(error).toBeNever()) });
  });

  it("type-checks onError before the handlers", () => {
    // onError's parameter is typed before a handler with unannotated
    // parameters that follows it, so it widens to `unknown` (still sound)...
    Forms.enhance({
      onError: (error) => {
        expectTypeOf(error).toEqualTypeOf<unknown>();
        return Effect.void;
      },
      onResult: ({ result }) => Forms.applyAction(result),
    });
    Forms.enhance({
      onError: (error) => {
        expectTypeOf(error).toEqualTypeOf<unknown>();
        return Effect.void;
      },
      onSubmit: ({ action }) => Effect.fail(new Invalid({ field: action.pathname })),
      onResult: ({ result }) => Forms.applyAction(result),
    });

    // ...but stays precise for handlers whose parameters need no inference...
    Forms.enhance({
      onError: (error) => {
        expectTypeOf(error).toEqualTypeOf<Invalid | Forms.ApplyActionError>();
        return Effect.void;
      },
      onSubmit: () => Effect.fail(new Invalid({ field: "title" })),
      onResult: (options: Forms.ResultOptions) => Forms.applyAction(options.result),
    });

    // ...and for absent handlers, which contribute nothing.
    Forms.enhance({
      onError: (error) => Effect.sync(() => expectTypeOf(error).toBeNever()),
      onSubmit: () => Effect.void,
    });

    // An annotated onError is checked against the handlers' errors either way.
    Forms.enhance({
      onError: (error: Forms.ApplyActionError) => Effect.log(error.cause),
      onResult: ({ result }) => Forms.applyAction(result),
    });
    Forms.enhance({
      onError: (error: Invalid | Forms.ApplyActionError) => Effect.log(error._tag),
      onSubmit: ({ action }) => Effect.fail(new Invalid({ field: action.pathname })),
      onResult: ({ result }) => Forms.applyAction(result),
    });
    Forms.enhance({
      // @ts-expect-error: the handlers fail with ApplyActionError, not Invalid
      onError: (error: Invalid) => Effect.log(error.field),
      onResult: ({ result }) => Forms.applyAction(result),
    });
  });

  it("rejects an onError that does not fit the handlers", () => {
    Forms.enhance({
      onResult: ({ result }) => Forms.applyAction(result),
      // @ts-expect-error: the handlers fail with ApplyActionError, not Invalid
      onError: (error: Invalid) => Effect.log(error.field),
    });

    Forms.enhance({
      onResult: ({ result }) => Forms.applyAction(result),
      // @ts-expect-error: onError must not fail
      onError: (error) => Effect.fail(error),
    });

    Forms.enhance({
      // @ts-expect-error: onError must not fail
      onError: (error) => Effect.fail(error),
      onResult: ({ result }) => Forms.applyAction(result),
    });

    Forms.enhance({
      onResult: ({ result }) => Forms.applyAction(result),
      // @ts-expect-error: a misspelt handler is rejected, not ignored
      onEror: (error: unknown) => Effect.log(error),
    });

    // A narrower annotation would let an error through unhandled.
    const onApplyActionError = (error: Forms.ApplyActionError) => Effect.log(error.cause);
    Forms.enhance({
      onSubmit: () => Effect.fail(new Invalid({ field: "title" })),
      onResult: ({ result }) => Forms.applyAction(result),
      // @ts-expect-error: onError must also accept Invalid
      onError: onApplyActionError,
    });
    Forms.enhance({
      // @ts-expect-error: onError must also accept Invalid
      onError: onApplyActionError,
      onSubmit: () => Effect.fail(new Invalid({ field: "title" })),
      onResult: ({ result }) => Forms.applyAction(result),
    });
    Forms.enhance({
      onResult: ({ result }) => Forms.deserialize(result.type),
      // @ts-expect-error: deserialize fails with unknown, which onError must accept
      onError: onApplyActionError,
    });
  });

  it("joins onError's requirements with the handlers'", () => {
    class Reporter extends Context.Service<Reporter, { readonly report: (e: unknown) => void }>()(
      "Reporter",
    ) {}
    const report = (error: unknown) =>
      Effect.gen(function* () {
        const reporter = yield* Reporter;
        reporter.report(error);
      });

    Forms.enhance(
      { onError: report, onResult: ({ result }) => Forms.applyAction(result) },
      { runtime: Context.make(Reporter, { report: () => {} }) },
    );
    Forms.enhance(
      // @ts-expect-error: the runtime does not provide Reporter
      { onResult: ({ result }) => Forms.applyAction(result), onError: report },
      { runtime: Context.empty() },
    );
  });

  it("requires a runtime when the handlers require services", () => {
    class Greeter extends Context.Service<Greeter, { readonly hi: string }>()("Greeter") {}
    class Clock extends Context.Service<Clock, { readonly now: number }>()("Clock") {}
    const greet = () =>
      Effect.gen(function* () {
        yield* Greeter;
      });
    const greeter = Context.make(Greeter, { hi: "hello" });

    // Without a runtime, the handlers would die with a missing-service defect.
    // @ts-expect-error: onSubmit requires Greeter, so a runtime is required
    Forms.enhance({ onSubmit: greet });
    // @ts-expect-error: onResult requires Greeter, so a runtime is required
    Forms.enhance({ onResult: greet });
    // @ts-expect-error: onError requires Greeter, so a runtime is required
    Forms.enhance({ onSubmit: () => Effect.fail(new Invalid({ field: "title" })), onError: greet });
    // @ts-expect-error: the options must name a runtime
    Forms.enhance({ onSubmit: greet }, {});
    // @ts-expect-error: the runtime must not be undefined
    Forms.enhance({ onSubmit: greet }, { runtime: undefined });
    Forms.enhance(
      { onSubmit: greet },
      // @ts-expect-error: the runtime must provide Greeter
      { runtime: Context.make(Clock, { now: 0 }) },
    );

    Forms.enhance({ onSubmit: greet }, { runtime: greeter });
    Forms.enhance(
      { onResult: greet },
      { runtime: ManagedRuntime.make(Layer.succeed(Greeter, { hi: "hello" })) },
    );
    // A runtime that provides more than the handlers require is fine.
    Forms.enhance({ onSubmit: greet }, { runtime: Context.add(greeter, Clock, { now: 0 }) });
  });

  it("accepts handlers that require different services from one runtime", () => {
    class Greeter extends Context.Service<Greeter, { readonly hi: string }>()("Greeter") {}
    class Clock extends Context.Service<Clock, { readonly now: number }>()("Clock") {}
    class Reporter extends Context.Service<Reporter, { readonly report: (e: unknown) => void }>()(
      "Reporter",
    ) {}
    const greet = Effect.gen(function* () {
      yield* Greeter;
    });
    const tick = Effect.gen(function* () {
      yield* Clock;
    });
    const report = (error: unknown) =>
      Effect.gen(function* () {
        const reporter = yield* Reporter;
        reporter.report(error);
      });
    const greeter = Context.make(Greeter, { hi: "hello" });
    const both = Context.add(greeter, Clock, { now: 0 });

    // Each handler's requirements count, not only the first one's.
    Forms.enhance({ onSubmit: () => greet, onResult: () => tick }, { runtime: both });
    Forms.enhance(
      {
        onSubmit: ({ cancel }) => greet.pipe(Effect.andThen(Effect.sync(cancel))),
        onResult: ({ update }) => tick.pipe(Effect.andThen(Effect.promise(() => update()))),
      },
      { runtime: both },
    );
    Forms.enhance(
      {
        onSubmit: () => greet.pipe(Effect.andThen(Effect.fail(new Invalid({ field: "title" })))),
        onError: (error) => report(error),
      },
      { runtime: Context.add(greeter, Reporter, { report: () => {} }) },
    );
    Forms.enhance(
      { onSubmit: () => greet, onResult: () => tick, onError: report },
      {
        runtime: ManagedRuntime.make(
          Layer.mergeAll(
            Layer.succeed(Greeter, { hi: "hello" }),
            Layer.succeed(Clock, { now: 0 }),
            Layer.succeed(Reporter, { report: () => {} }),
          ),
        ),
      },
    );

    // A runtime missing one handler's service is still rejected, on the runtime.
    Forms.enhance(
      { onSubmit: () => greet, onResult: () => tick },
      // @ts-expect-error: the runtime does not provide Clock (onResult)
      { runtime: greeter },
    );
    Forms.enhance(
      {
        onSubmit: ({ cancel }) => greet.pipe(Effect.andThen(Effect.sync(cancel))),
        onResult: ({ update }) => tick.pipe(Effect.andThen(Effect.promise(() => update()))),
      },
      // @ts-expect-error: the runtime does not provide Clock (onResult)
      { runtime: greeter },
    );
    Forms.enhance(
      {
        onSubmit: () => greet.pipe(Effect.andThen(Effect.fail(new Invalid({ field: "title" })))),
        onError: report,
      },
      // @ts-expect-error: the runtime does not provide Reporter (onError)
      { runtime: greeter },
    );
    // @ts-expect-error: the handlers require Greeter and Clock, so a runtime is required
    Forms.enhance({ onSubmit: () => greet, onResult: () => tick });
  });

  it("lets a generic wrapper forward its options", () => {
    class Greeter extends Context.Service<Greeter, { readonly hi: string }>()("Greeter") {}
    const greet = Effect.gen(function* () {
      yield* Greeter;
    });
    const greeter = Context.make(Greeter, { hi: "hello" });

    const wrap = <R>(handlers: EnhanceHandlers<R>, ...options: EnhanceOptionsArgs<R>) =>
      Forms.enhance(handlers, ...options);
    wrap({ onSubmit: () => greet }, { runtime: greeter });
    wrap({ onSubmit: () => Effect.void });
    // @ts-expect-error: onSubmit requires Greeter, so a runtime is required
    wrap({ onSubmit: () => greet });

    const wrapWithRuntime = <R>(
      handlers: EnhanceHandlers<R>,
      options: { readonly runtime: EnhanceRuntime<R> },
    ) => Forms.enhance(handlers, options);
    wrapWithRuntime({ onSubmit: () => greet }, { runtime: greeter });

    // An optional runtime would let handlers that require services run without one.
    const wrapOptional = <R>(handlers: EnhanceHandlers<R>, options: EnhanceOptions<R>) =>
      // @ts-expect-error: EnhanceOptions<R> may omit the runtime
      Forms.enhance(handlers, options);
    expectTypeOf(wrapOptional).returns.toEqualTypeOf<SubmitFunction>();
  });

  it("keeps the runtime optional when the handlers require no services", () => {
    Forms.enhance({});
    Forms.enhance({ onSubmit: () => Effect.void });
    Forms.enhance({ onResult: ({ result }) => Forms.applyAction(result) });
    Forms.enhance(
      { onResult: ({ result }) => Forms.applyAction(result), onError: () => Effect.void },
      {},
    );
    Forms.enhance({ onSubmit: () => Effect.void }, { runtime: undefined });
    Forms.enhance({ onSubmit: () => Effect.void }, undefined);
    Forms.enhance({ onSubmit: () => Effect.void }, { runtime: Context.empty() });
  });

  it("accepts handlers forwarded as undefined", () => {
    const optional: { readonly onResult?: undefined } = { onResult: undefined };
    Forms.enhance({ onSubmit: () => Effect.void, ...optional });
    Forms.enhance({ onSubmit: undefined, onResult: undefined, onError: undefined });

    const forwarded = (onResult?: (options: Forms.ResultOptions) => Effect.Effect<void>) =>
      Forms.enhance({ onSubmit: () => Effect.void, onResult });
    expectTypeOf(forwarded).returns.toEqualTypeOf<SubmitFunction>();
  });
});
