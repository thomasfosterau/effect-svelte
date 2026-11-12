import { it } from "@effect/vitest";
import { describe, expect } from "vite-plus/test";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { defer } from "../src/streamed-load.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// `defer(eff)` as the parent Effect a load would run: it succeeds with the
// deferred work's Promise, wrapped in an object as a load's data would be.
const runDefer = <A>(eff: Effect.Effect<A>): Effect.Effect<{ promise: Promise<A> }> =>
  Effect.gen(function* () {
    return { promise: yield* defer(eff) };
  });

interface AppServiceInterface {
  readonly getValue: () => Effect.Effect<string>;
}
class AppService extends Context.Service<AppService, AppServiceInterface>()("AppService") {}

// ---------------------------------------------------------------------------
// defer
// ---------------------------------------------------------------------------

describe("defer", () => {
  it.live("returns a Promise that resolves to the effect's value", () =>
    Effect.gen(function* () {
      const { promise } = yield* runDefer(Effect.succeed(42));
      yield* Effect.tryPromise(() => expect(promise).resolves.toBe(42));
    }),
  );

  it.live("provides the current context to the deferred effect", () =>
    Effect.gen(function* () {
      const slow = Effect.fn("slow")(function* () {
        const svc = yield* AppService;
        return yield* svc.getValue();
      });

      const layer = Layer.succeed(AppService, {
        getValue: () => Effect.succeed("from-service"),
      });

      const { promise } = yield* Effect.provide(
        Effect.gen(function* () {
          return { promise: yield* defer(slow()) };
        }),
        layer,
      );

      yield* Effect.tryPromise(() => expect(promise).resolves.toBe("from-service"));
    }),
  );

  it.live("the parent effect resolves immediately while the deferred work is in-flight", () =>
    Effect.gen(function* () {
      let resolved = false;

      const slow = Effect.fn("slow")(function* () {
        yield* Effect.sleep("50 millis");
        resolved = true;
        return "done";
      });

      const { promise } = yield* runDefer(slow());

      // The parent Effect returned immediately; the slow task is still pending.
      expect(resolved).toBe(false);

      yield* Effect.tryPromise(() => promise);
      expect(resolved).toBe(true);
    }),
  );

  it.live("the returned Promise rejects when the deferred Effect fails", () =>
    Effect.gen(function* () {
      const slow = Effect.fail("boom");

      const { promise } = yield* Effect.gen(function* () {
        return { promise: yield* defer(slow) };
      });

      yield* Effect.tryPromise(() => expect(promise).rejects.toBeDefined());
    }),
  );

  it.live("Effect.catchTag provides a fallback when the deferred Effect fails", () =>
    Effect.gen(function* () {
      class Failed extends Schema.TaggedError<Failed>()("Failed", {}) {}
      const slow = Effect.fail(new Failed()).pipe(
        Effect.catchTag("Failed", () => Effect.succeed("fallback")),
      );
      const { promise } = yield* runDefer(slow);
      yield* Effect.tryPromise(() => expect(promise).resolves.toBe("fallback"));
    }),
  );

  it.live("multiple defer calls launch effects concurrently", () =>
    Effect.gen(function* () {
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

      const { p1, p2 } = yield* Effect.gen(function* () {
        return {
          p1: yield* defer(task1()),
          p2: yield* defer(task2()),
        };
      });

      const [r1, r2] = yield* Effect.tryPromise(() => Promise.all([p1, p2]));

      expect(r1).toBe(1);
      expect(r2).toBe(2);
      // task2 finishes first (shorter delay) so it is pushed before task1
      expect(order).toEqual([2, 1]);
    }),
  );
});
