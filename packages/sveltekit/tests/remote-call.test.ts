import { describe, expect, it } from "vite-plus/test";
import { Cause, Effect, Exit, Stream } from "effect";
import {
  callCommand,
  callCommandWithUpdates,
  callPrerender,
  callQuery,
  liveQueryStream,
  submitForm,
  submitFormWithUpdates,
} from "../src/Remote.js";

/**
 * Runs `effect` and asserts it failed on the error channel with exactly
 * `error` (a `Fail` reason), not as a defect (a `Die` reason).
 */
const expectFailsWith = async (
  effect: Effect.Effect<unknown, unknown, never>,
  error: unknown,
): Promise<void> => {
  const exit = await Effect.runPromise(Effect.exit(effect));
  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) return;
  expect(Cause.hasDies(exit.cause)).toBe(false);
  expect(exit.cause.reasons).toHaveLength(1);
  const [reason] = exit.cause.reasons;
  expect(reason !== undefined && Cause.isFailReason(reason)).toBe(true);
  expect(reason !== undefined && Cause.isFailReason(reason) ? reason.error : undefined).toBe(error);
};

/**
 * A remote-call result that rejects with `error` when awaited, including via
 * `.updates()`. The base promise is pre-marked as handled, so leaving it
 * un-awaited (when only `.updates()` is) reports no unhandled rejection;
 * awaiting it still rejects.
 */
const rejecting = (error: unknown) => {
  const base = Promise.reject(error);
  base.catch(() => {});
  return Object.assign(base, { updates: () => Promise.reject(error) });
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
  it("callQuery / callCommand / callPrerender succeed with the remote output", async () => {
    const inputs: Array<unknown> = [];
    const remote = ((input: unknown) => {
      inputs.push(input);
      return resolving(42);
    }) as never;

    expect(await Effect.runPromise(callQuery(remote))).toBe(42);
    expect(await Effect.runPromise(callQuery(remote, "q"))).toBe(42);
    expect(await Effect.runPromise(callCommand(remote))).toBe(42);
    expect(await Effect.runPromise(callCommand(remote, "c"))).toBe(42);
    expect(await Effect.runPromise(callPrerender(remote))).toBe(42);
    expect(await Effect.runPromise(callPrerender(remote, "p"))).toBe(42);
    expect(inputs).toEqual([undefined, "q", undefined, "c", undefined, "p"]);
  });

  it("callCommandWithUpdates / submitFormWithUpdates forward the queries to updates()", async () => {
    const updatesCalls: Array<Array<unknown>> = [];
    const query = { refresh: () => {} } as never;

    const command = ((input: unknown) => resolving(`ok:${String(input)}`, updatesCalls)) as never;
    expect(await Effect.runPromise(callCommandWithUpdates(command, "x", query))).toBe("ok:x");

    const submit = (() => resolving(true, updatesCalls)) as never;
    expect(await Effect.runPromise(submitFormWithUpdates(submit, query))).toBeUndefined();
    expect(await Effect.runPromise(submitForm(() => resolving(true)))).toBeUndefined();

    expect(updatesCalls).toEqual([[query], [query]]);
  });
});

describe("Remote call helpers: a rejected call fails on the error channel", () => {
  const boom = new Error("remote call rejected");
  const reject = (() => rejecting(boom)) as never;

  it("callQuery (no input and with input)", async () => {
    await expectFailsWith(callQuery(reject), boom);
    await expectFailsWith(callQuery(reject, "input"), boom);
  });

  it("callCommand (no input and with input)", async () => {
    await expectFailsWith(callCommand(reject), boom);
    await expectFailsWith(callCommand(reject, "input"), boom);
  });

  it("callCommandWithUpdates", async () => {
    await expectFailsWith(callCommandWithUpdates(reject, "input", {} as never), boom);
  });

  it("callPrerender (no input and with input)", async () => {
    await expectFailsWith(callPrerender(reject), boom);
    await expectFailsWith(callPrerender(reject, "input"), boom);
  });

  it("submitForm and submitFormWithUpdates", async () => {
    await expectFailsWith(submitForm(reject), boom);
    await expectFailsWith(submitFormWithUpdates(reject, {} as never), boom);
  });

  it("keeps a non-Error rejection reason as-is", async () => {
    const reason = { status: 404, body: { message: "Not found" } };
    await expectFailsWith(callQuery((() => rejecting(reason)) as never), reason);
  });

  it("maps a synchronous throw from the remote function onto the error channel", async () => {
    const throws = (() => {
      throw boom;
    }) as never;
    await expectFailsWith(callQuery(throws), boom);
    await expectFailsWith(callCommand(throws, "input"), boom);
    await expectFailsWith(submitForm(throws), boom);
  });

  it("reaches an Effect.catch handler", async () => {
    const recovered = await Effect.runPromise(
      callQuery(reject).pipe(Effect.catch((error) => Effect.succeed(error))),
    );
    expect(recovered).toBe(boom);
  });
});

describe("liveQueryStream", () => {
  it("consumes a RemoteLiveQuery (AsyncIterable) as a Stream", async () => {
    const live = {
      async *[Symbol.asyncIterator]() {
        yield 1;
        yield 2;
        yield 3;
      },
    } as never;

    const values = await Effect.runPromise(Stream.runCollect(liveQueryStream<number>(live)));
    expect(values).toEqual([1, 2, 3]);
  });

  it("surfaces iteration errors on the Stream's error channel", async () => {
    const boom = new Error("boom");
    const live = {
      // eslint-disable-next-line require-yield
      async *[Symbol.asyncIterator]() {
        throw boom;
      },
    } as never;

    const exit = await Effect.runPromise(Effect.exit(Stream.runCollect(liveQueryStream(live))));
    expect(exit._tag).toBe("Failure");
  });
});
