import { afterEach, assert, describe, expect, it } from "vite-plus/test";
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { mount, tick, unmount } from "svelte";
import Boundary from "./Boundary.svelte";
import Counting from "./Counting.svelte";
import Reactive from "./Reactive.svelte";
import Typed from "./Typed.svelte";
import { MultiplierLayer } from "./service.js";

/**
 * Drive the async pipeline to quiescence: a stream emission crosses a fiber
 * boundary (macrotask) → sets `$state.raw` → recomputes the `$derived` promise →
 * the `<svelte:boundary>` await settles (microtask) → the DOM updates. A couple
 * of rounds of "wait a tick, flush" covers that chain.
 */
const settle = (): Promise<void> => {
  const rounds = async (remaining: number): Promise<void> => {
    if (remaining === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await tick();
    return rounds(remaining - 1);
  };
  return rounds(3);
};

const mountTarget = (): HTMLElement => {
  const target = document.createElement("div");
  document.body.appendChild(target);
  return target;
};

const text = (target: HTMLElement, id: string): string | null =>
  target.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() ?? null;

/**
 * Polls `check` (with a `tick()` between attempts) until it returns `true`;
 * rejects with a `TimeoutError` once `timeoutMs` elapses.
 */
const waitFor = (check: () => boolean, timeoutMs = 2000): Promise<void> => {
  const poll: Effect.Effect<void, Cause.UnknownError> = Effect.suspend(() =>
    check()
      ? Effect.void
      : Effect.sleep(Duration.millis(5)).pipe(
          Effect.andThen(Effect.tryPromise(() => tick())),
          Effect.andThen(poll),
        ),
  );
  return Effect.runPromise(Effect.timeout(poll, Duration.millis(timeoutMs)));
};

type Mounted = Parameters<typeof unmount>[0];

const mounted: Array<{ component: Mounted; target: HTMLElement }> = [];
const track = (component: Mounted, target: HTMLElement): void => {
  mounted.push({ component, target });
};

afterEach(() => {
  Arr.forEach(mounted.splice(0), ({ component, target }) => {
    void unmount(component);
    target.remove();
  });
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
        makeFor: (cursor: number) => {
          const queue = queues[cursor];
          assert.isDefined(queue);
          return Stream.fromQueue(queue);
        },
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

    // Waiting while the second subscription is still pending its first value.
    expect(text(target, "waiting")).toBe("true");

    await runtime.runPromise(Queue.offer(second, 20));
    await settle();
    expect(text(target, "value")).toBe("value:20");
    // The new subscription's first emission clears `waiting` again.
    expect(text(target, "waiting")).toBe("false");

    await runtime.dispose();
  });

  it("one subscription serves many emissions (self-invalidation regression)", async () => {
    // A self-invalidating `$effect` reads its own result state, so every
    // emission (which writes that state) re-triggers the effect and
    // re-subscribes — the thunk below would run roughly once per emission
    // instead of once for the component's whole lifetime.
    const runtime = ManagedRuntime.make(Layer.empty);
    const target = mountTarget();

    const component = mount(Counting, {
      target,
      props: {
        make: () => Stream.fromSchedule(Schedule.spaced("5 millis")),
        runtime,
      },
    });
    track(component, target);

    await waitFor(() => Number(text(target, "value") ?? "-1") >= 5);

    expect(Number(text(target, "calls"))).toBeLessThan(3);

    await runtime.dispose();
  });

  it("`waiting` clears after the first emission", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const target = mountTarget();

    const component = mount(Counting, {
      target,
      props: {
        make: () => Stream.fromSchedule(Schedule.spaced("5 millis")),
        runtime,
      },
    });
    track(component, target);

    await waitFor(() => text(target, "tag") === "Success");

    expect(text(target, "waiting")).toBe("false");

    await runtime.dispose();
  });
});
