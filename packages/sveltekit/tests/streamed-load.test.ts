import { describe, expect, it } from "vite-plus/test";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { defer } from "../src/streamed-load.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// JS/TS auto-flattens nested Promises, so `await Effect.runPromise(defer(eff))`
// gives `A`, not `Promise<A>`. Wrapping in an object prevents the flattening.
const runDefer = <A>(eff: Effect.Effect<A, never, never>): Promise<{ promise: Promise<A> }> =>
  Effect.runPromise(
    Effect.gen(function* () {
      return { promise: yield* defer(eff) };
    }),
  );

interface AppServiceInterface {
  readonly getValue: () => Effect.Effect<string>;
}
class AppService extends Context.Service<AppService, AppServiceInterface>()("AppService") {}

// ---------------------------------------------------------------------------
// defer
// ---------------------------------------------------------------------------

describe("defer", () => {
  it("returns a Promise that resolves to the effect's value", async () => {
    const { promise } = await runDefer(Effect.succeed(42));
    await expect(promise).resolves.toBe(42);
  });

  it("provides the current context to the deferred effect", async () => {
    const slow = Effect.fn("slow")(function* () {
      const svc = yield* AppService;
      return yield* svc.getValue();
    });

    const layer = Layer.succeed(AppService, {
      getValue: () => Effect.succeed("from-service"),
    });

    const { promise } = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          return { promise: yield* defer(slow()) };
        }),
        layer,
      ),
    );

    await expect(promise).resolves.toBe("from-service");
  });

  it("the parent effect resolves immediately while the deferred work is in-flight", async () => {
    let resolved = false;

    const slow = Effect.fn("slow")(function* () {
      yield* Effect.sleep("50 millis");
      resolved = true;
      return "done";
    });

    const { promise } = await runDefer(slow());

    // The parent Effect returned immediately; the slow task is still pending.
    expect(resolved).toBe(false);

    await promise;
    expect(resolved).toBe(true);
  });

  it("the returned Promise rejects when the deferred Effect fails", async () => {
    const slow = Effect.fail("boom");

    const { promise } = await Effect.runPromise(
      Effect.gen(function* () {
        return { promise: yield* defer(slow) };
      }),
    );

    await expect(promise).rejects.toBeDefined();
  });

  it("Effect.catchTag provides a fallback when the deferred Effect fails", async () => {
    class Failed extends Schema.TaggedError<Failed>()("Failed", {}) {}
    const slow = Effect.fail(new Failed()).pipe(
      Effect.catchTag("Failed", () => Effect.succeed("fallback")),
    );
    const { promise } = await runDefer(slow);
    await expect(promise).resolves.toBe("fallback");
  });

  it("multiple defer calls launch effects concurrently", async () => {
    const order: number[] = [];

    const task1 = Effect.fn("task1")(function* () {
      yield* Effect.sleep("30 millis");
      order.push(1);
      return 1;
    });
    const task2 = Effect.fn("task2")(function* () {
      yield* Effect.sleep("10 millis");
      order.push(2);
      return 2;
    });

    const { p1, p2 } = await Effect.runPromise(
      Effect.gen(function* () {
        return {
          p1: yield* defer(task1()),
          p2: yield* defer(task2()),
        };
      }),
    );

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe(1);
    expect(r2).toBe(2);
    // task2 finishes first (shorter delay) so it is pushed before task1
    expect(order).toEqual([2, 1]);
  });
});
