import { afterEach, describe, expect, it } from "vite-plus/test";
import { Layer, ManagedRuntime, Queue, Stream, SubscriptionRef } from "effect";
import { mount, tick, unmount } from "svelte";
import Boundary from "./Boundary.svelte";
import Reactive from "./Reactive.svelte";
import Typed from "./Typed.svelte";
import { MultiplierLayer } from "./service.js";

/**
 * Drive the async pipeline to quiescence: a stream emission crosses a fiber
 * boundary (macrotask) → sets `$state.raw` → recomputes the `$derived` promise →
 * the `<svelte:boundary>` await settles (microtask) → the DOM updates. A couple
 * of rounds of "wait a tick, flush" covers that chain.
 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    await tick();
  }
};

const mountTarget = (): HTMLElement => {
  const target = document.createElement("div");
  document.body.appendChild(target);
  return target;
};

const text = (target: HTMLElement, id: string): string | null =>
  target.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() ?? null;

const mounted: Array<{ component: Record<string, unknown>; target: HTMLElement }> = [];
const track = <T extends Record<string, unknown>>(component: T, target: HTMLElement): void => {
  mounted.push({ component, target });
};

afterEach(() => {
  for (const { component, target } of mounted.splice(0)) {
    void unmount(component);
    target.remove();
  }
});

describe("useLiveStream (DOM boundary)", () => {
  it("seeds `current`/`promise` from `initial` — value shows immediately, never pending", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const queue = await runtime.runPromise(Queue.unbounded<number>());
    const target = mountTarget();

    const component = mount(Boundary, {
      target,
      props: {
        make: () => Stream.fromQueue(queue),
        runtime,
        initial: 7,
        hasInitial: true,
      },
    });
    track(component, target);
    await settle();

    // Pre-resolved promise from the seed → the value renders, pending never shows.
    expect(text(target, "value")).toBe("value:7");
    expect(text(target, "status")).toBeNull();

    await runtime.dispose();
  });

  it("is pending until the first emission, then resolves", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const queue = await runtime.runPromise(Queue.unbounded<number>());
    const target = mountTarget();

    const component = mount(Boundary, {
      target,
      props: { make: () => Stream.fromQueue(queue), runtime },
    });
    track(component, target);
    await settle();

    // No seed, no emission yet → the boundary shows its pending snippet.
    expect(text(target, "status")).toBe("pending");
    expect(text(target, "value")).toBeNull();

    await runtime.runPromise(Queue.offer(queue, 1));
    await settle();

    expect(text(target, "value")).toBe("value:1");
    expect(text(target, "status")).toBeNull();

    await runtime.dispose();
  });

  it("replaces per emission without flashing pending again", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const queue = await runtime.runPromise(Queue.unbounded<number>());
    const target = mountTarget();

    const component = mount(Boundary, {
      target,
      props: { make: () => Stream.fromQueue(queue), runtime },
    });
    track(component, target);

    await runtime.runPromise(Queue.offer(queue, 1));
    await settle();
    expect(text(target, "value")).toBe("value:1");

    await runtime.runPromise(Queue.offer(queue, 2));
    await settle();
    expect(text(target, "value")).toBe("value:2");
    // Each emission is an already-resolved promise — no pending between them.
    expect(text(target, "status")).toBeNull();

    await runtime.dispose();
  });

  it("rejects into the boundary's `failed` snippet on stream failure", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const target = mountTarget();

    const component = mount(Boundary, {
      target,
      props: { make: () => Stream.fail("boom"), runtime },
    });
    track(component, target);
    await settle();

    expect(text(target, "error")).toBe("error:boom");

    await runtime.dispose();
  });

  it("runs against an explicit typed runtime via options.runtime", async () => {
    const runtime = ManagedRuntime.make(MultiplierLayer);
    const target = mountTarget();

    const component = mount(Typed, { target, props: { runtime } });
    track(component, target);
    await settle();

    // factor (3) * 4
    expect(text(target, "value")).toBe("value:12");

    await runtime.dispose();
  });

  it("keeps the previous value visible while re-subscribing on a reactive-input change", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const cursorRef = await runtime.runPromise(SubscriptionRef.make(0));
    const first = await runtime.runPromise(Queue.unbounded<number>());
    const second = await runtime.runPromise(Queue.unbounded<number>());
    const queues = [first, second];
    const target = mountTarget();

    const component = mount(Reactive, {
      target,
      props: {
        runtime,
        cursorRef,
        makeFor: (cursor: number) => Stream.fromQueue(queues[cursor]!),
      },
    });
    track(component, target);

    await runtime.runPromise(Queue.offer(first, 10));
    await settle();
    expect(text(target, "value")).toBe("value:10");

    // Change the cursor → interrupt the first subscription, subscribe the second.
    await runtime.runPromise(SubscriptionRef.set(cursorRef, 1));
    await settle();

    // Stale-while-revalidate: the previous value is still shown (no pending
    // flash) until the new subscription emits.
    expect(text(target, "value")).toBe("value:10");
    expect(text(target, "status")).toBeNull();

    await runtime.runPromise(Queue.offer(second, 20));
    await settle();
    expect(text(target, "value")).toBe("value:20");

    await runtime.dispose();
  });
});
