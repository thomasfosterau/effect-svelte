import { describe, expect, it } from "vite-plus/test";
import { Effect, Layer, ManagedRuntime, Stream, SubscriptionRef } from "effect";
import { get, writable } from "svelte/store";
import { streamFromStore, streamToStore, subscriptionRefToStore } from "../src/store.js";

/** Yields to the event loop so forked reader fibers can drain pending values. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("streamFromStore", () => {
  it("emits the store's current value on subscribe", async () => {
    const store = writable(42);

    // The readable store contract emits the current value synchronously on
    // subscribe, so taking one value is deterministic.
    const values = await Effect.runPromise(
      Stream.runCollect(Stream.take(streamFromStore(store), 1)),
    );
    expect(values).toEqual([42]);
  });

  it("forwards every value pushed by the store contract", async () => {
    // A custom readable that pushes several values synchronously on subscribe.
    const store = {
      subscribe(run: (value: number) => void) {
        run(1);
        run(2);
        run(3);
        return () => {};
      },
    };

    const values = await Effect.runPromise(
      Stream.runCollect(Stream.take(streamFromStore(store), 3)),
    );
    expect(values).toEqual([1, 2, 3]);
  });
});

describe("subscriptionRefToStore", () => {
  it("exposes the ref's current value as the store's initial value", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const ref = await runtime.runPromise(SubscriptionRef.make(42));

    const store = subscriptionRefToStore(ref, runtime);

    // `get` subscribes and reads synchronously, so it observes the initial
    // value supplied to `readable` before the fiber has had a chance to run.
    expect(get(store)).toBe(42);

    await runtime.dispose();
  });

  it("observes updates pushed to the ref", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const ref = await runtime.runPromise(SubscriptionRef.make(0));

    const store = subscriptionRefToStore(ref, runtime);

    const observed: Array<number> = [];
    const unsubscribe = store.subscribe((value) => observed.push(value));

    // `SubscriptionRef.changes` re-emits the current value on subscribe.
    await flush();

    await runtime.runPromise(SubscriptionRef.set(ref, 1));
    await flush();
    await runtime.runPromise(SubscriptionRef.set(ref, 2));
    await flush();

    // The store starts at `0` (both the `readable` initial value and the value
    // `changes` re-emits on subscribe — Svelte dedupes the duplicate), then
    // forwards each subsequent ref update in order.
    expect(observed).toEqual([0, 1, 2]);

    unsubscribe();
    await runtime.dispose();
  });

  it("interrupts the fiber once the last subscriber unsubscribes", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const ref = await runtime.runPromise(SubscriptionRef.make(0));

    const store = subscriptionRefToStore(ref, runtime);

    const observed: Array<number> = [];
    const unsubscribe = store.subscribe((value) => observed.push(value));
    await flush();

    unsubscribe();
    await flush();

    // After unsubscribing the fiber is interrupted, so further ref updates are
    // not forwarded to the (now absent) subscriber.
    await runtime.runPromise(SubscriptionRef.set(ref, 99));
    await flush();

    expect(observed).toEqual([0]);

    await runtime.dispose();
  });
});

describe("streamToStore", () => {
  it("reads the initial value before any subscription", () => {
    const runtime = ManagedRuntime.make(Layer.empty);

    const store = streamToStore(Stream.never, -1, runtime);

    // `Stream.never` keeps the fiber alive without emitting, so the store
    // reports the value passed to `readable`.
    expect(get(store)).toBe(-1);

    void runtime.dispose();
  });

  it("converges on the latest value emitted by the stream", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);

    const store = streamToStore(Stream.fromArray([1, 2, 3]), -1, runtime);

    const observed: Array<number> = [];
    const unsubscribe = store.subscribe((value) => observed.push(value));
    await flush();

    // The stream emits eagerly, so the store settles on its final value. The
    // exact intermediate notifications depend on Svelte's scheduling, so we
    // assert on the converged value rather than the full sequence.
    expect(observed.at(-1)).toBe(3);

    unsubscribe();
    await runtime.dispose();
  });
});
