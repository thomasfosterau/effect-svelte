/**
 * The hooks that start a run from inside their own `$effect` (`useEffect` with
 * `immediate: true`, `useQuery`, `useDerived`, `reactiveQuery`) must not make
 * that effect depend on their own result state (#127).
 *
 * Starting a run reads the result (`startWaiting` keeps the previous value),
 * and a synchronous Effect settles before `runFork` returns (`settle` carries
 * the previous value forward). If either read is tracked, every write to the
 * result re-runs the effect — which interrupts and restarts the Effect — until
 * Svelte throws `effect_update_depth_exceeded`.
 *
 * Synchronous Effects settle inside the `$effect`, so `flushSync()` after
 * `mount` is enough to see the settled result; asynchronous ones are released
 * and observed through `Deferred`s and the probe's `onSuccess`, never a timer.
 */
import { Context, Deferred, Effect, ManagedRuntime } from "effect";
import { Reactivity } from "effect/reactivity";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { useDerived } from "../../src/derived.svelte.js";
import { useEffect } from "../../src/effect.svelte.js";
import { useQuery } from "../../src/query.svelte.js";
import { reactiveQuery } from "../../src/reactivity.svelte.js";
import ResultProbe from "./ResultProbe.svelte";
import { makeMounter, text } from "./helpers.js";

const mounter = makeMounter();
afterEach(mounter.cleanup);

const runtime = Context.empty();

/** Mounts the probe and runs the hook's mount effects synchronously. */
interface ProbeProps {
  readonly use: () => { readonly current: AsyncResult.AsyncResult<unknown, unknown> };
  readonly onSuccess?: (value: unknown) => void;
}

const mountProbe = (props: ProbeProps) => {
  const target = mounter.mount(ResultProbe, props);
  flushSync();
  return target;
};

/** A promise that resolves with the first value the probe reports as `Success`. */
const nextSuccess = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((r) => (resolve = r));
  return { promise, onSuccess: (value: unknown) => resolve(value) };
};

describe("useEffect({ immediate: true })", () => {
  it("runs a synchronous Effect once and renders its Success", () => {
    let starts = 0;
    const target = mountProbe({
      use: () =>
        useEffect(
          Effect.sync(() => ++starts),
          { immediate: true, runtime },
        ),
    });

    expect(starts).toBe(1);
    expect(text(target, "tag")).toBe("Success");
    expect(text(target, "waiting")).toBe("false");
    expect(text(target, "value")).toBe("1");
  });

  it("settles a synchronous failure once", () => {
    let starts = 0;
    const target = mountProbe({
      use: () =>
        useEffect(
          Effect.suspend(() => {
            starts++;
            return Effect.fail("boom");
          }),
          { immediate: true, runtime },
        ),
    });

    expect(starts).toBe(1);
    expect(text(target, "tag")).toBe("Failure");
  });

  it("runs an asynchronous Effect once, then settles to Success", async () => {
    const gate = Effect.runSync(Deferred.make<number>());
    const success = nextSuccess();
    let starts = 0;
    const target = mountProbe({
      use: () =>
        useEffect(
          Effect.suspend(() => {
            starts++;
            return Deferred.await(gate);
          }),
          { immediate: true, runtime },
        ),
      onSuccess: success.onSuccess,
    });

    expect(starts).toBe(1);
    expect(text(target, "tag")).toBe("Initial");
    expect(text(target, "waiting")).toBe("true");

    Effect.runSync(Deferred.succeed(gate, 42));
    expect(await success.promise).toBe(42);
    flushSync();

    expect(starts).toBe(1);
    expect(text(target, "tag")).toBe("Success");
    expect(text(target, "waiting")).toBe("false");
  });

  it("interrupts the running Effect on unmount", async () => {
    const interrupted = Effect.runSync(Deferred.make<void>());
    let starts = 0;
    const target = document.createElement("div");
    document.body.appendChild(target);
    const component = mount(ResultProbe, {
      target,
      props: {
        use: () =>
          useEffect(
            Effect.suspend(() => {
              starts++;
              return Effect.never;
            }).pipe(Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))),
            { immediate: true, runtime },
          ),
      },
    });
    flushSync();
    expect(starts).toBe(1);

    await unmount(component);
    target.remove();

    await Effect.runPromise(Deferred.await(interrupted));
    expect(starts).toBe(1);
  });

  it("does not subscribe to state the Effect reads while it starts", () => {
    // `run()` from a click handler tracks nothing; `immediate` must match, or
    // the hook silently re-runs whenever state read by the Effect changes.
    const box = $state({ n: 1 });
    let starts = 0;
    const target = mountProbe({
      use: () =>
        useEffect(
          Effect.sync(() => {
            starts++;
            return box.n;
          }),
          { immediate: true, runtime },
        ),
    });
    expect(text(target, "value")).toBe("1");

    box.n = 2;
    flushSync();

    expect(starts).toBe(1);
    expect(text(target, "value")).toBe("1");
  });
});

describe("useEffect setData", () => {
  it("can be called from an $effect without re-running it", () => {
    let writes = 0;
    const target = mountProbe({
      use: () => {
        const hook = useEffect(Effect.succeed(0), { runtime });
        $effect(() => {
          writes++;
          hook.setData((previous) => (previous ?? 0) + 1);
        });
        return hook;
      },
    });

    expect(writes).toBe(1);
    expect(text(target, "tag")).toBe("Success");
    expect(text(target, "value")).toBe("1");
  });
});

describe("useQuery", () => {
  it("runs once on mount and renders its Success", () => {
    let starts = 0;
    const target = mountProbe({
      use: () =>
        useQuery(
          Effect.sync(() => ++starts),
          { runtime },
        ),
    });

    expect(starts).toBe(1);
    expect(text(target, "tag")).toBe("Success");
    expect(text(target, "value")).toBe("1");
  });
});

describe("useDerived", () => {
  it("runs once per dependency change, not once per settle", () => {
    const box = $state({ n: 1 });
    let starts = 0;
    const target = mountProbe({
      use: () =>
        useDerived(
          () => {
            const n = box.n;
            return Effect.sync(() => {
              starts++;
              return n * 10;
            });
          },
          { runtime },
        ),
    });

    expect(starts).toBe(1);
    expect(text(target, "tag")).toBe("Success");
    expect(text(target, "value")).toBe("10");

    box.n = 2;
    flushSync();

    expect(starts).toBe(2);
    expect(text(target, "value")).toBe("20");
  });
});

describe("reactiveQuery", () => {
  it("runs once on mount and renders its Success", async () => {
    const managed = ManagedRuntime.make(Reactivity.layer);
    const reactivity = await managed.context();
    const success = nextSuccess();
    let starts = 0;
    const target = mountProbe({
      use: () =>
        reactiveQuery(
          () => ["probe"],
          () => Effect.sync(() => ++starts),
          { runtime: reactivity },
        ),
      onSuccess: success.onSuccess,
    });

    expect(await success.promise).toBe(1);
    flushSync();

    expect(starts).toBe(1);
    expect(text(target, "tag")).toBe("Success");
    expect(text(target, "waiting")).toBe("false");

    mounter.cleanup();
    await managed.dispose();
  });
});
