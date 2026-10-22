import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { refWriter } from "../src/internal/writable.js";

/** Yields to the event loop so the forked write fibers can settle. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("refWriter", () => {
  it("set replaces the ref's value", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const ref = await runtime.runPromise(SubscriptionRef.make(1));

    const writer = refWriter(runtime, ref);
    writer.set(42);
    await flush();

    expect(await runtime.runPromise(SubscriptionRef.get(ref))).toBe(42);

    await runtime.dispose();
  });

  it("update applies a function to the current value", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const ref = await runtime.runPromise(SubscriptionRef.make(10));

    const writer = refWriter(runtime, ref);
    writer.update((n) => n + 5);
    await flush();

    expect(await runtime.runPromise(SubscriptionRef.get(ref))).toBe(15);

    await runtime.dispose();
  });

  it("successive writes accumulate", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const ref = await runtime.runPromise(SubscriptionRef.make(0));

    const writer = refWriter(runtime, ref);
    writer.set(1);
    await flush();
    writer.update((n) => n * 10);
    await flush();
    writer.update((n) => n + 3);
    await flush();

    expect(await runtime.runPromise(SubscriptionRef.get(ref))).toBe(13);

    await runtime.dispose();
  });

  it("writes are observed by the ref's changes stream", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const ref = await runtime.runPromise(SubscriptionRef.make("a"));

    // `changes` re-emits the current value on subscribe, then each write.
    const observed: Array<string> = [];
    const fiber = runtime.runFork(
      Stream.runForEach(SubscriptionRef.changes(ref), (v) =>
        Effect.sync(() => {
          observed.push(v);
        }),
      ),
    );
    await flush();

    const writer = refWriter(runtime, ref);
    writer.set("b");
    await flush();

    fiber.interruptUnsafe();
    expect(observed).toEqual(["a", "b"]);

    await runtime.dispose();
  });
});
