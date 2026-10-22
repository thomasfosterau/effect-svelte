import { describe, expect, it } from "vite-plus/test";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { resultToPromise } from "../src/internal/await.js";

/** Resolves true if `promise` stays pending across a macrotask. */
const isPending = (promise: Promise<unknown>): Promise<boolean> => {
  const marker = Symbol("pending");
  return Promise.race([
    promise.then(
      () => false,
      () => false,
    ),
    new Promise<typeof marker>((resolve) => setTimeout(() => resolve(marker), 10)),
  ]).then((r) => r === marker);
};

describe("resultToPromise", () => {
  it("resolves a Success with its value", async () => {
    const promise = resultToPromise(AsyncResult.success<number, never>(42));
    await expect(promise).resolves.toBe(42);
  });

  it("resolves a waiting Success with the stale value (stale-while-revalidate)", async () => {
    const stale = AsyncResult.waiting(AsyncResult.success<number, never>(7));
    const promise = resultToPromise(stale);
    await expect(promise).resolves.toBe(7);
  });

  it("rejects a Failure with the typed error", async () => {
    const result = AsyncResult.failure<number, string>(Cause.fail("boom"));
    const promise = resultToPromise(result);
    await expect(promise).rejects.toBe("boom");
  });

  it("prefers the error over a carried-forward previous value", async () => {
    const result = AsyncResult.failureWithPrevious<number, string>(Cause.fail("nope"), {
      previous: Option.some(AsyncResult.success<number, string>(1)),
    });
    const promise = resultToPromise(result);
    await expect(promise).rejects.toBe("nope");
  });

  it("stays pending for the Initial state", async () => {
    const promise = resultToPromise(AsyncResult.initial<number, never>());
    expect(await isPending(promise)).toBe(true);
  });

  it("stays pending for a waiting Initial (no value yet)", async () => {
    const promise = resultToPromise(AsyncResult.initial<number, never>(true));
    expect(await isPending(promise)).toBe(true);
  });
});
