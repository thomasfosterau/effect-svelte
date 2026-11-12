/**
 * `Forms.applyAction` against the `$app/forms` stand-in: a rejection (or a
 * synchronous throw, as Kit's server build does) lands on the error channel as
 * an `ApplyActionError` carrying the original cause, never as a defect. Then
 * `Forms.enhance` with handlers that fail: a failure reaches `onError`, or
 * rejects without it; a defect always rejects.
 */

import type {
  ActionResult,
  SubmitFunction,
  applyAction as kitApplyAction,
  deserialize as kitDeserialize,
} from "$app/forms";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as P from "effect/Predicate";
import * as Schema from "effect/Schema";
import { it } from "@effect/vitest";
import { afterEach, assert, describe, expect, expectTypeOf } from "vite-plus/test";
import * as Forms from "../../src/forms.js";
import type {
  EnhanceHandlers,
  EnhanceOptions,
  EnhanceOptionsArgs,
  EnhanceRuntime,
  SubmitInput,
} from "../../src/forms.js";
import { formsStubs, resetFormsStubs } from "./fixtures/app-forms.js";
import { ForeignError } from "../fixtures/foreign-error.js";

afterEach(resetFormsStubs);

/** The type of a call that the function's own signature does not accept. */
interface Rejected {
  readonly rejected: true;
}

/**
 * `f` with `fallback`'s signatures as further overloads, so a call that `f`'s
 * own signature rejects resolves to `fallback`'s and takes its return type,
 * `Rejected`, where a call under an expect-error directive would not compile.
 * The call site is the real one: TypeScript infers `f`'s type parameters and
 * types the arguments as it does for a call to `f`, and only then falls back.
 * At runtime it is `f` itself (`fallback` has no properties to copy).
 */
const orRejected = <F extends object, Fallback>(f: F, fallback: Fallback): F & Fallback =>
  Object.assign(f, fallback);

/** What {@link enhanceOrRejected} returns for a call `Forms.enhance` rejects. */
type RejectedSubmit = SubmitFunction & Rejected;

/** A handler's result, whatever it fails with or requires. */
type AnyHandlerResult = Effect.Effect<void, unknown, unknown>;

/**
 * Accepts any handlers and options. The constraint only gives unannotated
 * handler parameters their types: `Handlers` is inferred from the argument, so
 * it admits a key `Forms.enhance` does not know.
 */
/** The handler keys `Forms.enhance` knows. */
type HandlerName = "onSubmit" | "onResult" | "onError";

interface RejectedEnhance {
  <
    Handlers extends {
      readonly onSubmit?: (input: SubmitInput) => AnyHandlerResult;
      readonly onResult?: (options: Forms.ResultOptions) => AnyHandlerResult;
      readonly onError?: (error: never) => AnyHandlerResult;
    },
  >(
    handlers: Handlers,
    ...options: ReadonlyArray<unknown>
  ): RejectedSubmit;
  /** Handlers whose values are not functions at all, such as an explicit `undefined`. */
  (
    handlers: Partial<Readonly<Record<HandlerName, Forms.EnhanceHandlers[HandlerName]>>>,
    ...options: ReadonlyArray<unknown>
  ): RejectedSubmit;
}
const rejectedEnhance: RejectedEnhance = () =>
  assert.fail("only its type is used: orRejected() returns the function itself");

/** `Forms.enhance`, typing a call it rejects as a {@link RejectedSubmit}. */
const enhanceOrRejected = orRejected(Forms.enhance, rejectedEnhance);

/** Accepts one or two type arguments of any type, as `Forms.deserialize` does not. */
interface RejectedDeserialize {
  <_Success>(result: string): Rejected;
  <_Success, _Failure>(result: string): Rejected;
}
const rejectedDeserialize: RejectedDeserialize = () =>
  assert.fail("only its type is used: orRejected() returns the function itself");

/** `Forms.deserialize`, typing a call it rejects as {@link Rejected}. */
const deserializeOrRejected = orRejected(Forms.deserialize, rejectedDeserialize);

/**
 * Runs `effect` and returns the single error it failed with on the error
 * channel (a `Fail` reason), asserting it did not die.
 */
const failureOf = <E>(effect: Effect.Effect<unknown, E>): Effect.Effect<E> =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect);
    assert(Exit.isFailure(exit), "expected the effect to fail");
    expect(Cause.hasDies(exit.cause)).toBe(false);
    expect(exit.cause.reasons).toHaveLength(1);
    const [reason] = exit.cause.reasons;
    assert(reason !== undefined && Cause.isFailReason(reason), "expected a single Fail reason");
    return reason.error;
  });

const redirect: ActionResult = { type: "redirect", status: 303, location: "/done" };
const success: ActionResult = { type: "success", status: 200, location: "/" };

describe("Forms.applyAction", () => {
  it.effect("passes the result to SvelteKit and succeeds", () =>
    Effect.gen(function* () {
      const calls: Array<unknown> = [];
      formsStubs.applyAction = (result) => {
        calls.push(result);
        return Promise.resolve();
      };

      yield* Forms.applyAction(redirect);
      expect(calls).toEqual([redirect]);
    }),
  );

  it.effect("fails with an ApplyActionError carrying the rejection", () =>
    Effect.gen(function* () {
      const cause = new ForeignError("https://svelte.dev/e/kit/navigation_route_missing");
      formsStubs.applyAction = () => Promise.reject(cause);

      const error = yield* failureOf(Forms.applyAction(redirect));
      expect(error).toMatchObject({ _tag: "ApplyActionError", cause });
    }),
  );

  it.effect("fails with an ApplyActionError when SvelteKit throws synchronously", () => {
    // Kit's server build throws synchronously (`server_api_unavailable`).
    const cause = new ForeignError("Cannot call applyAction(...) on the server");
    formsStubs.applyAction = () => {
      throw cause;
    };

    return Effect.gen(function* () {
      const error = yield* failureOf(Forms.applyAction(redirect));
      expect(error).toMatchObject({ _tag: "ApplyActionError", cause });
    });
  });

  it.effect("is an ApplyActionError instance that Effect.catchTag recovers from", () =>
    Effect.gen(function* () {
      const cause = new ForeignError("chunk failed to load");
      formsStubs.applyAction = () => Promise.reject(cause);

      const error = yield* failureOf(Forms.applyAction(redirect));
      expect(error).toBeInstanceOf(Forms.ApplyActionError);

      const recovered = yield* Forms.applyAction(redirect).pipe(
        Effect.as("applied"),
        Effect.catchTag("ApplyActionError", (e) => Effect.succeed(e.cause)),
      );
      expect(recovered).toBe(cause);
    }),
  );
});

describe("Forms.deserialize", () => {
  it("has the type parameters of $app/forms' deserialize: both or neither", () => {
    // With neither, each is its constraint: any result `applyAction` accepts.
    expectTypeOf(Forms.deserialize("{}")).toEqualTypeOf<
      Effect.Effect<Parameters<typeof Forms.applyAction>[0], unknown>
    >();
    expectTypeOf(Forms.deserialize<{ id: string }, { message: string }>("{}")).toEqualTypeOf<
      Effect.Effect<ActionResult<{ id: string }, { message: string }>, unknown>
    >();
    // `Failure` has no default, as in `$app/forms`.
    expectTypeOf(deserializeOrRejected<{ id: string }>("{}")).toEqualTypeOf<Rejected>();
  });

  it("constrains Success and Failure as $app/forms does", () => {
    // The constraints are read off SvelteKit's `applyAction`, so the wrappers
    // accept and produce exactly what SvelteKit's functions do.
    expectTypeOf<Parameters<typeof Forms.applyAction>[0]>().toEqualTypeOf<
      Parameters<typeof kitApplyAction>[0]
    >();
    expectTypeOf(Forms.deserialize("{}")).toEqualTypeOf<
      Effect.Effect<ReturnType<typeof kitDeserialize>, unknown>
    >();
    // An action that returns nothing has `undefined` data.
    expectTypeOf(Forms.deserialize<undefined, undefined>("{}")).toEqualTypeOf<
      Effect.Effect<ActionResult<undefined, undefined>, unknown>
    >();
    // The data of an action is a record (or undefined), as in `$app/forms`.
    expectTypeOf(deserializeOrRejected<string, undefined>("{}")).toEqualTypeOf<Rejected>();
    // `null` is not action data, as in `$app/forms`.
    expectTypeOf(deserializeOrRejected<{ id: string }, null>("{}")).toEqualTypeOf<Rejected>();
  });
});

/** A `SubmitFunction` input whose `cancel()` is recorded in `cancelled`. */
const submitInput = () => {
  let cancelled = false;
  // SAFETY: `Forms.enhance`'s submit phase only calls `cancel()` on its input
  // (the handlers these tests run read nothing else), so the other fields of
  // a `SubmitInput` are never touched.
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
  assert(P.isFunction(callback), "expected a result callback");
  let updates = 0;
  const update = () => {
    updates++;
    return Promise.resolve();
  };
  // SAFETY: `Forms.enhance`'s result phase reads only `result` and `update`
  // from SvelteKit's callback options; the rest are never touched.
  await callback({ result, update } as Parameters<typeof callback>[0]);
  return updates;
};

/** An `onError` annotated with one error only: too narrow for handlers that fail with more. */
const onApplyActionError = (error: Forms.ApplyActionError) => Effect.log(error.cause);

// The generic wrappers of "lets a generic wrapper forward its options": type
// probes for how a wrapper generic in `R` may hand its options to `Forms.enhance`.

/** Forwards the handlers and the options tuple, runtime required exactly when `R` is. */
const wrap = <R>(handlers: EnhanceHandlers<R>, ...options: EnhanceOptionsArgs<R>) =>
  Forms.enhance(handlers, ...options);

/** Forwards options that always carry a runtime. */
const wrapWithRuntime = <R>(
  handlers: EnhanceHandlers<R>,
  options: { readonly runtime: EnhanceRuntime<R> },
) => Forms.enhance(handlers, options);

/** Forwards options whose runtime is optional, which `Forms.enhance` rejects. */
const wrapOptional = <R>(handlers: EnhanceHandlers<R>, options: EnhanceOptions<R>) =>
  enhanceOrRejected(handlers, options);

describe("Forms.enhance with failing handlers", () => {
  class Invalid extends Schema.TaggedError<Invalid>()("Invalid", { field: Schema.String }) {}

  /** Every error the handlers in these tests fail with. */
  type HandlerError = Invalid | Forms.ApplyActionError;

  /** Handlers a wrapper forwards: an optional `onResult`, absent when the key is omitted. */
  interface OptionalOnResult {
    readonly onResult?: (options: Forms.ResultOptions) => Effect.Effect<void>;
  }

  it("routes a failed applyAction returned from onResult to onError", async () => {
    const cause = new ForeignError("navigation failed");
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
      onResult: ({ update }) => Effect.tryPromise(() => update()),
      onError: (error) => Effect.sync(() => seen.push(error)),
    });

    expect(await runEnhanced(submit, success)).toBe(1);
    expect(seen).toEqual([]);
  });

  it("does not call onError when onResult succeeds or recovers", async () => {
    const seen: Array<unknown> = [];
    const onError = (error: Forms.ApplyActionError) => Effect.sync(() => seen.push(error));

    await runEnhanced(
      Forms.enhance({ onResult: ({ result }) => Forms.applyAction(result), onError }),
      redirect,
    );

    formsStubs.applyAction = () => Promise.reject(new ForeignError("navigation failed"));
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
    const cause = new ForeignError("navigation failed");
    formsStubs.applyAction = () => Promise.reject(cause);
    const submit = Forms.enhance({ onResult: ({ result }) => Forms.applyAction(result) });

    await expect(runEnhanced(submit, redirect)).rejects.toSatisfy(
      (error) => error instanceof Forms.ApplyActionError && error.cause === cause,
    );
  });

  it("rejects on a defect without calling onError", async () => {
    const cause = new ForeignError("navigation failed");
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
    class Reporter extends Context.Service<
      Reporter,
      { readonly report: (e: HandlerError) => void }
    >()("Reporter") {}
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
    // The handlers fail with ApplyActionError, not Invalid.
    expectTypeOf(
      enhanceOrRejected({
        onError: (error: Invalid) => Effect.log(error.field),
        onResult: ({ result }) => Forms.applyAction(result),
      }),
    ).toEqualTypeOf<RejectedSubmit>();
  });

  it("rejects an onError that does not fit the handlers", () => {
    // The handlers fail with ApplyActionError, not Invalid.
    expectTypeOf(
      enhanceOrRejected({
        onResult: ({ result }) => Forms.applyAction(result),
        onError: (error: Invalid) => Effect.log(error.field),
      }),
    ).toEqualTypeOf<RejectedSubmit>();

    // onError must not fail.
    expectTypeOf(
      enhanceOrRejected({
        onResult: ({ result }) => Forms.applyAction(result),
        onError: (error) => Effect.fail(error),
      }),
    ).toEqualTypeOf<RejectedSubmit>();
    expectTypeOf(
      enhanceOrRejected({
        onError: (error) => Effect.fail(error),
        onResult: ({ result }) => Forms.applyAction(result),
      }),
    ).toEqualTypeOf<RejectedSubmit>();

    // A misspelt handler is rejected, not ignored.
    expectTypeOf(
      enhanceOrRejected({
        onResult: ({ result }) => Forms.applyAction(result),
        onEror: (error: Forms.ApplyActionError) => Effect.log(error),
      }),
    ).toEqualTypeOf<RejectedSubmit>();

    // A narrower annotation would let an error through unhandled: onError must
    // also accept Invalid.
    expectTypeOf(
      enhanceOrRejected({
        onSubmit: () => Effect.fail(new Invalid({ field: "title" })),
        onResult: ({ result }) => Forms.applyAction(result),
        onError: onApplyActionError,
      }),
    ).toEqualTypeOf<RejectedSubmit>();
    expectTypeOf(
      enhanceOrRejected({
        onError: onApplyActionError,
        onSubmit: () => Effect.fail(new Invalid({ field: "title" })),
        onResult: ({ result }) => Forms.applyAction(result),
      }),
    ).toEqualTypeOf<RejectedSubmit>();
    // deserialize fails with unknown, which onError must accept.
    expectTypeOf(
      enhanceOrRejected({
        onResult: ({ result }) => Forms.deserialize(result.type),
        onError: onApplyActionError,
      }),
    ).toEqualTypeOf<RejectedSubmit>();
  });

  it("joins onError's requirements with the handlers'", () => {
    class Reporter extends Context.Service<
      Reporter,
      { readonly report: (e: HandlerError) => void }
    >()("Reporter") {}
    const report = (error: HandlerError) =>
      Effect.gen(function* () {
        const reporter = yield* Reporter;
        reporter.report(error);
      });

    Forms.enhance(
      { onError: report, onResult: ({ result }) => Forms.applyAction(result) },
      { runtime: Context.make(Reporter, { report: () => {} }) },
    );
    // The runtime does not provide Reporter.
    expectTypeOf(
      enhanceOrRejected(
        { onResult: ({ result }) => Forms.applyAction(result), onError: report },
        { runtime: Context.empty() },
      ),
    ).toEqualTypeOf<RejectedSubmit>();
  });

  it("reports a missing or wrong runtime on the call or the runtime, not a handler", () => {
    class Greeter extends Context.Service<Greeter, { readonly hi: string }>()("Greeter") {}
    class Reporter extends Context.Service<
      Reporter,
      { readonly report: (e: HandlerError) => void }
    >()("Reporter") {}
    // Passed by name, so TypeScript infers its requirements before those of
    // the handlers whose parameters are not annotated.
    const report = (error: HandlerError) =>
      Effect.gen(function* () {
        const reporter = yield* Reporter;
        reporter.report(error);
      });
    const greeter = Context.make(Greeter, { hi: "hello" });
    const reporter = Context.make(Reporter, { report: () => {} });

    // onError requires Reporter, so a runtime is required.
    expectTypeOf(
      enhanceOrRejected({
        onResult: ({ result }) => Forms.applyAction(result),
        onError: report,
      }),
    ).toEqualTypeOf<RejectedSubmit>();
    expectTypeOf(
      enhanceOrRejected({
        onSubmit: ({ action }) => Effect.fail(new Invalid({ field: action.pathname })),
        onError: report,
      }),
    ).toEqualTypeOf<RejectedSubmit>();
    // The handlers require Greeter and Reporter, so a runtime is required.
    expectTypeOf(
      enhanceOrRejected({
        onResult: ({ result }) => Greeter.use(() => Forms.applyAction(result)),
        onError: report,
      }),
    ).toEqualTypeOf<RejectedSubmit>();
    // The runtime does not provide Reporter (onError).
    expectTypeOf(
      enhanceOrRejected(
        {
          onResult: ({ result }) => Greeter.use(() => Forms.applyAction(result)),
          onError: report,
        },
        { runtime: greeter },
      ),
    ).toEqualTypeOf<RejectedSubmit>();
    // The runtime does not provide Greeter (onResult).
    expectTypeOf(
      enhanceOrRejected(
        {
          onResult: ({ result }) => Greeter.use(() => Forms.applyAction(result)),
          onError: report,
        },
        { runtime: reporter },
      ),
    ).toEqualTypeOf<RejectedSubmit>();
    // The handlers alone are accepted: with a runtime that provides both
    // services the same call type-checks, so each rejection above is the
    // missing or wrong runtime's.
    expectTypeOf(
      enhanceOrRejected(
        {
          onResult: ({ result }) => Greeter.use(() => Forms.applyAction(result)),
          onError: report,
        },
        { runtime: Context.merge(greeter, reporter) },
      ),
    ).toEqualTypeOf<SubmitFunction>();
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
    // onSubmit requires Greeter, so a runtime is required.
    expectTypeOf(enhanceOrRejected({ onSubmit: greet })).toEqualTypeOf<RejectedSubmit>();
    // onResult requires Greeter, so a runtime is required.
    expectTypeOf(enhanceOrRejected({ onResult: greet })).toEqualTypeOf<RejectedSubmit>();
    // onError requires Greeter, so a runtime is required.
    expectTypeOf(
      enhanceOrRejected({
        onSubmit: () => Effect.fail(new Invalid({ field: "title" })),
        onError: greet,
      }),
    ).toEqualTypeOf<RejectedSubmit>();
    // The options must name a runtime.
    expectTypeOf(enhanceOrRejected({ onSubmit: greet }, {})).toEqualTypeOf<RejectedSubmit>();
    // The runtime must not be undefined.
    expectTypeOf(
      enhanceOrRejected({ onSubmit: greet }, { runtime: undefined }),
    ).toEqualTypeOf<RejectedSubmit>();
    // The runtime must provide Greeter.
    expectTypeOf(
      enhanceOrRejected({ onSubmit: greet }, { runtime: Context.make(Clock, { now: 0 }) }),
    ).toEqualTypeOf<RejectedSubmit>();

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
    class Reporter extends Context.Service<
      Reporter,
      { readonly report: (e: HandlerError) => void }
    >()("Reporter") {}
    const greet = Effect.fn("greet")(function* () {
      yield* Greeter;
    });
    const tick = Effect.fn("tick")(function* () {
      yield* Clock;
    });
    const report = (error: HandlerError) =>
      Effect.gen(function* () {
        const reporter = yield* Reporter;
        reporter.report(error);
      });
    const greeter = Context.make(Greeter, { hi: "hello" });
    const both = Context.add(greeter, Clock, { now: 0 });

    // Each handler's requirements count, not only the first one's.
    Forms.enhance({ onSubmit: () => greet(), onResult: () => tick() }, { runtime: both });
    Forms.enhance(
      {
        onSubmit: ({ cancel }) => greet().pipe(Effect.andThen(Effect.sync(cancel))),
        onResult: ({ update }) => tick().pipe(Effect.andThen(Effect.tryPromise(() => update()))),
      },
      { runtime: both },
    );
    Forms.enhance(
      {
        onSubmit: () => greet().pipe(Effect.andThen(Effect.fail(new Invalid({ field: "title" })))),
        onError: (error) => report(error),
      },
      { runtime: Context.add(greeter, Reporter, { report: () => {} }) },
    );
    Forms.enhance(
      { onSubmit: () => greet(), onResult: () => tick(), onError: report },
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

    // A runtime missing one handler's service is still rejected: here it does
    // not provide Clock (onResult).
    expectTypeOf(
      enhanceOrRejected({ onSubmit: () => greet(), onResult: () => tick() }, { runtime: greeter }),
    ).toEqualTypeOf<RejectedSubmit>();
    expectTypeOf(
      enhanceOrRejected(
        {
          onSubmit: ({ cancel }) => greet().pipe(Effect.andThen(Effect.sync(cancel))),
          onResult: ({ update }) => tick().pipe(Effect.andThen(Effect.tryPromise(() => update()))),
        },
        { runtime: greeter },
      ),
    ).toEqualTypeOf<RejectedSubmit>();
    // The runtime does not provide Reporter (onError).
    expectTypeOf(
      enhanceOrRejected(
        {
          onSubmit: () =>
            greet().pipe(Effect.andThen(Effect.fail(new Invalid({ field: "title" })))),
          onError: report,
        },
        { runtime: greeter },
      ),
    ).toEqualTypeOf<RejectedSubmit>();
    // The handlers require Greeter and Clock, so a runtime is required.
    expectTypeOf(
      enhanceOrRejected({ onSubmit: () => greet(), onResult: () => tick() }),
    ).toEqualTypeOf<RejectedSubmit>();
  });

  it("lets a generic wrapper forward its options", () => {
    class Greeter extends Context.Service<Greeter, { readonly hi: string }>()("Greeter") {}
    const greet = Effect.fn("greet")(function* () {
      yield* Greeter;
    });
    const greeter = Context.make(Greeter, { hi: "hello" });

    wrap({ onSubmit: () => greet() }, { runtime: greeter });
    wrap({ onSubmit: () => Effect.void });
    // onSubmit requires Greeter, so a runtime is required.
    expectTypeOf(
      orRejected(wrap, rejectedEnhance)({ onSubmit: () => greet() }),
    ).toEqualTypeOf<RejectedSubmit>();

    wrapWithRuntime({ onSubmit: () => greet() }, { runtime: greeter });

    // An optional runtime would let handlers that require services run without
    // one: EnhanceOptions<R> may omit the runtime, so the call is rejected.
    expectTypeOf(wrapOptional).returns.toEqualTypeOf<RejectedSubmit>();
  });

  it("keeps the runtime optional when the handlers require no services", () => {
    Forms.enhance({});
    Forms.enhance({ onSubmit: () => Effect.void });
    Forms.enhance({ onResult: ({ result }) => Forms.applyAction(result) });
    Forms.enhance(
      { onResult: ({ result }) => Forms.applyAction(result), onError: () => Effect.void },
      {},
    );
    Forms.enhance({ onSubmit: () => Effect.void }, { runtime: Context.empty() });
    // An absent runtime, or absent options, are left out rather than `undefined`.
    // The runtime is omitted, not set to undefined.
    expectTypeOf(
      enhanceOrRejected({ onSubmit: () => Effect.void }, { runtime: undefined }),
    ).toEqualTypeOf<RejectedSubmit>();
    // The options are omitted, not passed as undefined.
    expectTypeOf(
      enhanceOrRejected({ onSubmit: () => Effect.void }, undefined),
    ).toEqualTypeOf<RejectedSubmit>();
  });

  it("treats an effect requiring any or unknown as requiring no services", () => {
    // Only a top type fits every handler in TypeScript's first inference pass,
    // so requirements typed as `any` or `unknown` (to which a union with
    // `unknown` collapses) count as none, and no runtime is demanded (see
    // `RequiredServices`).
    const anyR: Effect.Effect<void, never, any> = Effect.void;
    const unknownR: Effect.Effect<void, never, unknown> = Effect.void;

    expectTypeOf(Forms.enhance({ onSubmit: () => anyR })).toEqualTypeOf<SubmitFunction>();
    Forms.enhance({ onResult: () => anyR });
    Forms.enhance({
      onSubmit: () => Effect.fail(new Invalid({ field: "title" })),
      onError: () => anyR,
    });
    Forms.enhance({ onSubmit: () => unknownR, onResult: () => unknownR });
  });

  it("accepts handlers forwarded with an absent (omitted) handler", () => {
    const optional: OptionalOnResult = {};
    Forms.enhance({ onSubmit: () => Effect.void, ...optional });

    const forwarded = (handlers: OptionalOnResult) =>
      Forms.enhance({ onSubmit: () => Effect.void, ...handlers });
    expectTypeOf(forwarded).returns.toEqualTypeOf<SubmitFunction>();
  });

  it("takes an absent handler as an omitted key, not as undefined", async () => {
    // An absent handler is omitted, not set to undefined.
    const submit = enhanceOrRejected({
      onSubmit: undefined,
      onResult: undefined,
      onError: undefined,
    });
    expectTypeOf(submit).toEqualTypeOf<RejectedSubmit>();

    // An optional parameter may be undefined, which the key may not.
    const viaParameter = (onResult?: (options: Forms.ResultOptions) => Effect.Effect<void>) =>
      enhanceOrRejected({ onSubmit: () => Effect.void, onResult });
    expectTypeOf(viaParameter).returns.toEqualTypeOf<RejectedSubmit>();

    // A plain JavaScript caller that does pass `undefined` gets the same
    // behaviour as omitting the handlers: nothing runs before the request, and
    // SvelteKit's default result behaviour applies.
    const { input, cancelled } = submitInput();
    await expect(submit(input)).resolves.toBeUndefined();
    expect(cancelled()).toBe(false);
    await expect(viaParameter()(input)).resolves.toBeUndefined();
  });
});
