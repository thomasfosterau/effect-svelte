import { it } from "@effect/vitest";
import { assert, describe, expect } from "vite-plus/test";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Stream from "effect/Stream";
import {
  callCommand,
  callCommandWithUpdates,
  callPrerender,
  callQuery,
  liveQueryStream,
  submitForm,
  submitFormWithUpdates,
} from "../src/Remote.js";
import { ForeignError } from "./fixtures/foreign-error.js";

/**
 * Runs `effect` and asserts it failed on the error channel with exactly
 * `error` (a `Fail` reason), not as a defect (a `Die` reason).
 */
const expectFailsWith = <E>(effect: Effect.Effect<unknown, E>, error: E): Effect.Effect<void> =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect);
    assert(Exit.isFailure(exit), "expected the effect to fail");
    expect(Cause.hasDies(exit.cause)).toBe(false);
    expect(exit.cause.reasons).toHaveLength(1);
    const [reason] = exit.cause.reasons;
    assert(reason !== undefined && Cause.isFailReason(reason), "expected a single Fail reason");
    expect(reason.error).toBe(error);
  });

/**
 * A remote-call result that rejects with `error` when awaited, including via
 * `.updates()`. The base promise is pre-marked as handled, so leaving it
 * un-awaited (when only `.updates()` is) reports no unhandled rejection;
 * awaiting it still rejects.
 */
const rejecting = <E>(reason: E) => {
  const base = Promise.reject(reason);
  base.catch(() => {});
  return Object.assign(base, { updates: () => Promise.reject(reason) });
};

/** A remote-call result that resolves with `value`, recording `.updates()` calls. */
const resolving = <A>(value: A, updatesCalls: Array<Array<unknown>> = []) =>
  Object.assign(Promise.resolve(value), {
    updates: (...queries: Array<unknown>) => {
      updatesCalls.push(queries);
      return Promise.resolve(value);
    },
  });

describe("Remote call helpers: success", () => {
  it.effect("callQuery / callCommand / callPrerender succeed with the remote output", () =>
    Effect.gen(function* () {
      const inputs: Array<Option.Option<string>> = [];
      // SAFETY: `callQuery` / `callCommand` / `callPrerender` only call the remote
      // function and await its result, which `resolving` provides.
      const remote = ((input?: string) => {
        inputs.push(Option.fromUndefinedOr(input));
        return resolving(42);
      }) as never;

      expect(yield* callQuery(remote)).toBe(42);
      expect(yield* callQuery(remote, "q")).toBe(42);
      expect(yield* callCommand(remote)).toBe(42);
      expect(yield* callCommand(remote, "c")).toBe(42);
      expect(yield* callPrerender(remote)).toBe(42);
      expect(yield* callPrerender(remote, "p")).toBe(42);
      expect(inputs).toEqual([
        Option.none(),
        Option.some("q"),
        Option.none(),
        Option.some("c"),
        Option.none(),
        Option.some("p"),
      ]);
    }),
  );

  it.effect("callCommandWithUpdates / submitFormWithUpdates forward the queries to updates()", () =>
    Effect.gen(function* () {
      const updatesCalls: Array<Array<unknown>> = [];
      // SAFETY: the helpers only forward the queries to `.updates()`, which
      // records them; no query member is ever read.
      const query = { refresh: () => {} } as never;

      // SAFETY: `callCommandWithUpdates` only calls the command and its
      // `.updates()`, both of which `resolving` provides.
      const command = ((input: string) => resolving(`ok:${input}`, updatesCalls)) as never;
      expect(yield* callCommandWithUpdates(command, "x", query)).toBe("ok:x");

      // SAFETY: `submitFormWithUpdates` only calls `submit` and its `.updates()`,
      // both of which `resolving` provides.
      const submit = (() => resolving(true, updatesCalls)) as never;
      expect(yield* submitFormWithUpdates(submit, query)).toBeUndefined();
      expect(yield* submitForm(() => resolving(true))).toBeUndefined();

      expect(updatesCalls).toEqual([[query], [query]]);
    }),
  );
});

describe("Remote call helpers: a rejected call fails on the error channel", () => {
  const boom = new ForeignError("remote call rejected");
  // SAFETY: every helper only calls the remote function and awaits its result
  // (or its `.updates()`), both of which `rejecting` provides.
  const reject = (() => rejecting(boom)) as never;

  it.effect("callQuery (no input and with input)", () =>
    Effect.gen(function* () {
      yield* expectFailsWith(callQuery(reject), boom);
      yield* expectFailsWith(callQuery(reject, "input"), boom);
    }),
  );

  it.effect("callCommand (no input and with input)", () =>
    Effect.gen(function* () {
      yield* expectFailsWith(callCommand(reject), boom);
      yield* expectFailsWith(callCommand(reject, "input"), boom);
    }),
  );

  it.effect("callCommandWithUpdates", () =>
    Effect.gen(function* () {
      // SAFETY: the query is only forwarded to `.updates()`, which rejects.
      yield* expectFailsWith(callCommandWithUpdates(reject, "input", {} as never), boom);
    }),
  );

  it.effect("callPrerender (no input and with input)", () =>
    Effect.gen(function* () {
      yield* expectFailsWith(callPrerender(reject), boom);
      yield* expectFailsWith(callPrerender(reject, "input"), boom);
    }),
  );

  it.effect("submitForm and submitFormWithUpdates", () =>
    Effect.gen(function* () {
      yield* expectFailsWith(submitForm(reject), boom);
      // SAFETY: the query is only forwarded to `.updates()`, which rejects.
      yield* expectFailsWith(submitFormWithUpdates(reject, {} as never), boom);
    }),
  );

  it.effect("keeps a non-Error rejection reason as-is", () =>
    Effect.gen(function* () {
      const reason = { status: 404, body: { message: "Not found" } };
      // SAFETY: `callQuery` only calls the function and awaits the rejection.
      yield* expectFailsWith(callQuery((() => rejecting(reason)) as never), reason);
    }),
  );

  it.effect("maps a synchronous throw from the remote function onto the error channel", () => {
    // SAFETY: the function throws before any remote-function member is read.
    const throws = (() => {
      throw boom;
    }) as never;
    return Effect.gen(function* () {
      yield* expectFailsWith(callQuery(throws), boom);
      yield* expectFailsWith(callCommand(throws, "input"), boom);
      yield* expectFailsWith(submitForm(throws), boom);
    });
  });

  it.effect("reaches an Effect.catch handler", () =>
    Effect.gen(function* () {
      const recovered = yield* callQuery(reject).pipe(
        Effect.catchIf(P.isError, (error) => Effect.succeed(error)),
      );
      expect(recovered).toBe(boom);
    }),
  );
});

describe("liveQueryStream", () => {
  it.effect("consumes a RemoteLiveQuery (AsyncIterable) as a Stream", () =>
    Effect.gen(function* () {
      // SAFETY: `liveQueryStream` only iterates the live query, which this
      // async iterable supports.
      const live = {
        async *[Symbol.asyncIterator]() {
          yield 1;
          yield 2;
          yield 3;
        },
      } as never;

      const values = yield* Stream.runCollect(liveQueryStream<number>(live));
      expect(values).toEqual([1, 2, 3]);
    }),
  );

  it.effect("surfaces iteration errors on the Stream's error channel", () => {
    const boom = new ForeignError("boom");
    // SAFETY: `liveQueryStream` only iterates the live query, which this
    // async iterable supports.
    const live = {
      // eslint-disable-next-line require-yield
      async *[Symbol.asyncIterator]() {
        throw boom;
      },
    } as never;

    return Effect.gen(function* () {
      const exit = yield* Effect.exit(Stream.runCollect(liveQueryStream(live)));
      expect(exit._tag).toBe("Failure");
    });
  });
});
