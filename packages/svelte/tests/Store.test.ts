import { describe, expect, it } from "vite-plus/test";
import { Effect, Layer, ManagedRuntime, PubSub, Queue, Ref, Stream, SubscriptionRef } from "effect";
import { get, writable } from "svelte/store";
import * as Store from "../src/Store.js";

/** Yields to the event loop so forked reader fibers can drain pending values. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("Store.toStream", () => {
  it("emits the store's current value on subscribe", async () => {
    const store = writable(42);

    // The readable store contract emits the current value synchronously on
    // subscribe, so taking one value is deterministic.
    const values = await Effect.runPromise(
      Stream.runCollect(Stream.take(Store.toStream(store), 1)),
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
      Stream.runCollect(Stream.take(Store.toStream(store), 3)),
    );
    expect(values).toEqual([1, 2, 3]);
  });
});

describe("Store.fromSubscriptionRef", () => {
  it("exposes the ref's current value as the store's initial value", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const ref = await runtime.runPromise(SubscriptionRef.make(42));

    const store = Store.fromSubscriptionRef(ref, runtime);

    // `get` subscribes and reads synchronously, so it observes the initial
    // value supplied to `readable` before the fiber has had a chance to run.
    expect(get(store)).toBe(42);

    await runtime.dispose();
  });

  it("observes updates pushed to the ref", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const ref = await runtime.runPromise(SubscriptionRef.make(0));

    const store = Store.fromSubscriptionRef(ref, runtime);

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

    const store = Store.fromSubscriptionRef(ref, runtime);

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

describe("Store.fromStream", () => {
  it("reads the initial value before any subscription", () => {
    const runtime = ManagedRuntime.make(Layer.empty);

    const store = Store.fromStream(Stream.never, -1, runtime);

    // `Stream.never` keeps the fiber alive without emitting, so the store
    // reports the value passed to `readable`.
    expect(get(store)).toBe(-1);

    void runtime.dispose();
  });

  it("converges on the latest value emitted by the stream", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);

    const store = Store.fromStream(Stream.fromArray([1, 2, 3]), -1, runtime);

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

describe("Store.fromPubSub", () => {
  it("uses the initial value until a message is published", () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const pubsub = runtime.runSync(PubSub.unbounded<number>());

    const store = Store.fromPubSub(pubsub, -1, runtime);

    // No subscriber has read yet, so the store reports the `readable` initial.
    expect(get(store)).toBe(-1);

    void runtime.dispose();
  });

  it("converges on the latest published message", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const pubsub = runtime.runSync(PubSub.unbounded<number>());

    const store = Store.fromPubSub(pubsub, -1, runtime);

    const observed: Array<number> = [];
    const unsubscribe = store.subscribe((value) => observed.push(value));

    // Let the forked fiber subscribe to the PubSub before publishing, otherwise
    // messages published to a subscriber-less PubSub are dropped.
    await flush();

    await runtime.runPromise(PubSub.publish(pubsub, 1));
    await flush();
    await runtime.runPromise(PubSub.publish(pubsub, 2));
    await flush();

    // Starts at the initial value, then converges on the most recent message.
    expect(observed[0]).toBe(-1);
    expect(observed.at(-1)).toBe(2);

    unsubscribe();
    await runtime.dispose();
  });
});

describe("Store.fromQueue", () => {
  it("converges on the latest value taken from the queue", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const queue = runtime.runSync(Queue.unbounded<number>());

    // Pre-offer the values so they are buffered before any subscriber starts
    // taking from the queue; the reader then drains them deterministically.
    await runtime.runPromise(Queue.offerAll(queue, [1, 2, 3]));

    const store = Store.fromQueue(queue, -1, runtime);

    const observed: Array<number> = [];
    const unsubscribe = store.subscribe((value) => observed.push(value));
    await flush();

    // The pre-buffered values drain eagerly, so the store settles on the last
    // value taken. The exact intermediate notifications (and whether the `-1`
    // initial is observed before the drain) depend on Svelte's scheduling, so
    // we assert on the converged value rather than the full sequence.
    expect(observed.at(-1)).toBe(3);

    unsubscribe();
    await runtime.dispose();
  });
});

describe("Store.fromRef", () => {
  it("exposes the ref's current value as a static snapshot", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const ref = await runtime.runPromise(Ref.make(7));

    const store = Store.fromRef(ref, runtime);

    expect(get(store)).toBe(7);

    await runtime.dispose();
  });

  it("does not track later mutations for an existing subscriber", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const ref = await runtime.runPromise(Ref.make(0));

    const store = Store.fromRef(ref, runtime);

    const observed: Array<number> = [];
    const unsubscribe = store.subscribe((value) => observed.push(value));
    await flush();

    // A plain Ref has no change feed, so mutating it is invisible to the store.
    await runtime.runPromise(Ref.set(ref, 1));
    await flush();
    await runtime.runPromise(Ref.set(ref, 2));
    await flush();

    expect(observed).toEqual([0]);

    unsubscribe();
    await runtime.dispose();
  });

  it("snapshots the value at the time each subscriber subscribes", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const ref = await runtime.runPromise(Ref.make(0));

    const store = Store.fromRef(ref, runtime);

    // `get` subscribes, reads, and unsubscribes, so each call captures a fresh
    // snapshot of the ref at that moment.
    expect(get(store)).toBe(0);
    await runtime.runPromise(Ref.set(ref, 5));
    expect(get(store)).toBe(5);

    await runtime.dispose();
  });
});
