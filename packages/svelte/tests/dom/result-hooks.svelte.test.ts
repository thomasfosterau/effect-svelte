/**
 * The hooks that start a run from inside their own `$effect` (`useEffect` with
 * `immediate: true`, `useQuery`, `useDerived`, `useReactiveQuery`) must not make
 * that effect depend on their own result state (#127).
 *
 * Starting a run reads the result (`startWaiting` keeps the previous value),
 * and a synchronous Effect settles before `runFork` returns (`settle` carries
 * the previous value forward). If either read is tracked, every write to the
 * result re-runs the effect — which interrupts and restarts the Effect — until
 * Svelte throws `effect_update_depth_exceeded`.
 *
 * Only the hook's thunk (`useDerived`'s `fn`, `useReactiveQuery`'s `keys` and
 * `effectFn`) is tracked: state an Effect reads synchronously while it starts
 * is not a dependency, matching `useEffect({ immediate: true })`.
 *
 * `useReactiveStream` starts its run from a `createSubscriber` start callback,
 * which Svelte runs untracked, so it reads its thunks in a `$derived` instead;
 * the same split applies (#140). `useInvalidateKeys` re-runs queries on the
 * spot, so calling it from an `$effect` must not track their reads either.
 *
 * Synchronous Effects settle inside the `$effect`, so `flushSync()` after
 * `mount` is enough to see the settled result; asynchronous ones are released
 * and observed through `Deferred`s and the probe's `onSuccess`, never a timer.
 */
import { Cause, Context, Deferred, Effect, ManagedRuntime } from "effect";
import { Reactivity } from "effect/reactivity";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { useDerived } from "../../src/derived.svelte.js";
import { useEffect } from "../../src/effect.svelte.js";
import { makeResult } from "../../src/internal/result.svelte.js";
import { useQuery } from "../../src/query.svelte.js";
import {
  useReactiveQuery,
  useReactiveStream,
  useInvalidateKeys,
} from "../../src/reactivity.svelte.js";
import ResultProbe from "./ResultProbe.svelte";
import { makeMounter, text } from "./helpers.js";

const mounter = makeMounter();
afterEach(mounter.cleanup);

const runtime = Context.empty();

/** Mounts the probe and runs the hook's mount effects synchronously. */
interface ProbeProps {
  readonly use: () => { readonly current: AsyncResult.AsyncResult<unknown, unknown> };
  readonly onSuccess?: (value: unknown) => void;
  readonly onFailure?: () => void;
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

/**
 * Records every value the probe reports as `Success` (a waiting `Success`
 * included); `until` resolves once one matches, even if it already arrived.
 */
const successLog = () => {
  const values: Array<unknown> = [];
  const waiters: Array<{ match: (value: unknown) => boolean; resolve: () => void }> = [];
  return {
    values,
    onSuccess: (value: unknown) => {
      values.push(value);
      for (const waiter of waiters.splice(0)) {
        if (waiter.match(value)) waiter.resolve();
        else waiters.push(waiter);
      }
    },
    until: (match: (value: unknown) => boolean): Promise<void> =>
      values.some(match)
        ? Promise.resolve()
        : new Promise<void>((resolve) => waiters.push({ match, resolve })),
  };
};

/** A promise that resolves the first time the probe reports a `Failure`. */
const nextFailure = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, onFailure: () => resolve() };
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

  it("restarts for state the thunk reads, not state the Effect reads while it starts", () => {
    const dep = $state({ n: 1 });
    const inner = $state({ n: 100 });
    let starts = 0;
    const target = mountProbe({
      use: () =>
        useDerived(
          () => {
            const n = dep.n;
            return Effect.sync(() => {
              starts++;
              return n + inner.n;
            });
          },
          { runtime },
        ),
    });
    expect(starts).toBe(1);
    expect(text(target, "value")).toBe("101");

    // Read only inside the Effect: not a dependency, so no restart.
    inner.n = 200;
    flushSync();
    expect(starts).toBe(1);
    expect(text(target, "value")).toBe("101");

    // Read by the thunk: a dependency, so the run restarts (and sees `inner`).
    dep.n = 2;
    flushSync();
    expect(starts).toBe(2);
    expect(text(target, "value")).toBe("202");
  });
});

describe("useReactiveQuery", () => {
  it("runs once on mount and renders its Success", async () => {
    const managed = ManagedRuntime.make(Reactivity.layer);
    const reactivity = await managed.context();
    const success = nextSuccess();
    let starts = 0;
    const target = mountProbe({
      use: () =>
        useReactiveQuery(
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

  it("restarts for state the thunks read, not state the Effect reads while it starts", async () => {
    const managed = ManagedRuntime.make(Reactivity.layer);
    const reactivity = await managed.context();
    const log = successLog();
    const dep = $state({ n: 1 });
    const inner = $state({ n: 100 });
    let starts = 0;
    const target = mountProbe({
      use: () =>
        useReactiveQuery(
          () => ["probe", dep.n],
          () => {
            const n = dep.n;
            return Effect.sync(() => {
              starts++;
              return n + inner.n;
            });
          },
          { runtime: reactivity },
        ),
      onSuccess: log.onSuccess,
    });
    await log.until((value) => value === 101);
    flushSync();
    expect(starts).toBe(1);

    // Read only inside the Effect: not a dependency, so no restart. The
    // Effect runs synchronously inside `runFork`, so a restart would already
    // have bumped `starts` by the time `flushSync` returns.
    inner.n = 200;
    flushSync();
    expect(starts).toBe(1);
    expect(text(target, "value")).toBe("101");

    // Read by the thunks: a dependency, so the query restarts (and sees `inner`).
    dep.n = 2;
    flushSync();
    expect(starts).toBe(2);
    await log.until((value) => value === 202);
    flushSync();
    expect(text(target, "tag")).toBe("Success");
    expect(text(target, "waiting")).toBe("false");
    expect(text(target, "value")).toBe("202");

    mounter.cleanup();
    await managed.dispose();
  });

  it("restarts for state only the effect thunk reads", async () => {
    const managed = ManagedRuntime.make(Reactivity.layer);
    const reactivity = await managed.context();
    const log = successLog();
    const dep = $state({ n: 1 });
    let starts = 0;
    mountProbe({
      use: () =>
        useReactiveQuery(
          () => ["probe"],
          () => {
            const n = dep.n;
            return Effect.sync(() => {
              starts++;
              return n;
            });
          },
          { runtime: reactivity },
        ),
      onSuccess: log.onSuccess,
    });
    await log.until((value) => value === 1);
    flushSync();
    expect(starts).toBe(1);

    dep.n = 2;
    flushSync();
    expect(starts).toBe(2);
    await log.until((value) => value === 2);

    mounter.cleanup();
    await managed.dispose();
  });

  it("restarts for state only the keys thunk reads", async () => {
    const managed = ManagedRuntime.make(Reactivity.layer);
    const reactivity = await managed.context();
    const log = successLog();
    const dep = $state({ n: 1 });
    let starts = 0;
    mountProbe({
      use: () =>
        useReactiveQuery(
          () => ["probe", dep.n],
          () => Effect.sync(() => ++starts),
          { runtime: reactivity },
        ),
      onSuccess: log.onSuccess,
    });
    await log.until((value) => value === 1);
    flushSync();
    expect(starts).toBe(1);

    dep.n = 2;
    flushSync();
    expect(starts).toBe(2);
    await log.until((value) => value === 2);

    mounter.cleanup();
    await managed.dispose();
  });

  it("runs a synchronously failing Effect once and settles to Failure", async () => {
    const managed = ManagedRuntime.make(Reactivity.layer);
    const reactivity = await managed.context();
    const failure = nextFailure();
    let starts = 0;
    const target = mountProbe({
      use: () =>
        useReactiveQuery(
          () => ["probe"],
          () =>
            Effect.suspend(() => {
              starts++;
              return Effect.fail("boom");
            }),
          { runtime: reactivity },
        ),
      onFailure: failure.onFailure,
    });

    await failure.promise;
    flushSync();

    expect(starts).toBe(1);
    expect(text(target, "tag")).toBe("Failure");
    expect(text(target, "waiting")).toBe("false");

    mounter.cleanup();
    await managed.dispose();
  });
});

describe("useReactiveStream", () => {
  // `useReactiveStream` is built on `createSubscriber`, whose `start` runs
  // untracked: the thunks must be tracked some other way (#140).

  /** A `Reactivity` runtime plus a synchronous `invalidate` for the tests. */
  const makeReactivity = async () => {
    const managed = ManagedRuntime.make(Reactivity.layer);
    const runtime = await managed.context();
    return {
      runtime,
      invalidate: (keys: ReadonlyArray<unknown>) => managed.runSync(Reactivity.invalidate(keys)),
      dispose: async () => {
        mounter.cleanup();
        await managed.dispose();
      },
    };
  };

  it("runs once for every reader and appends a value per invalidation", async () => {
    const reactivity = await makeReactivity();
    const log = successLog();
    let starts = 0;
    // The probe reads `current` from its template and from an `$effect`: two
    // readers, one fiber.
    const target = mountProbe({
      use: () =>
        useReactiveStream(
          () => ["probe"],
          () => Effect.sync(() => ++starts),
          { runtime: reactivity.runtime },
        ),
      onSuccess: log.onSuccess,
    });
    expect(starts).toBe(1);
    expect(text(target, "tag")).toBe("Success");
    expect(text(target, "value")).toBe("1");

    // A re-run's value reaches the stream after an async boundary.
    reactivity.invalidate(["probe"]);
    expect(starts).toBe(2);
    await log.until((value) => String(value) === "1,2");
    flushSync();
    expect(starts).toBe(2);
    expect(text(target, "value")).toBe("1,2");

    await reactivity.dispose();
  });

  it("restarts for state only the keys thunk reads", async () => {
    const reactivity = await makeReactivity();
    const log = successLog();
    const dep = $state({ n: 1 });
    let starts = 0;
    const target = mountProbe({
      use: () =>
        useReactiveStream(
          // Each key is invalidated on its own, so each run gets a distinct one.
          () => [`probe-${dep.n}`],
          () => Effect.sync(() => ++starts),
          { runtime: reactivity.runtime },
        ),
      onSuccess: log.onSuccess,
    });
    expect(starts).toBe(1);
    expect(text(target, "value")).toBe("1");

    dep.n = 2;
    flushSync();
    // A fresh run: the values emitted under the old keys are dropped.
    expect(starts).toBe(2);
    expect(text(target, "value")).toBe("2");

    // The new run listens on the new keys, and the old one has stopped.
    reactivity.invalidate(["probe-2"]);
    expect(starts).toBe(3);
    await log.until((value) => String(value) === "2,3");
    reactivity.invalidate(["probe-1"]);
    expect(starts).toBe(3);

    await reactivity.dispose();
  });

  it("restarts for state only the effect thunk reads", async () => {
    const reactivity = await makeReactivity();
    const dep = $state({ n: 1 });
    let starts = 0;
    const target = mountProbe({
      use: () =>
        useReactiveStream(
          () => ["probe"],
          () => {
            const n = dep.n;
            return Effect.sync(() => {
              starts++;
              return n * 10;
            });
          },
          { runtime: reactivity.runtime },
        ),
    });
    expect(starts).toBe(1);
    expect(text(target, "value")).toBe("10");

    dep.n = 2;
    flushSync();
    expect(starts).toBe(2);
    expect(text(target, "value")).toBe("20");

    await reactivity.dispose();
  });

  it("does not restart for state the Effect reads while it runs", async () => {
    const reactivity = await makeReactivity();
    const log = successLog();
    const inner = $state({ n: 100 });
    let starts = 0;
    const target = mountProbe({
      use: () =>
        useReactiveStream(
          () => ["probe"],
          () =>
            Effect.sync(() => {
              starts++;
              return inner.n;
            }),
          { runtime: reactivity.runtime },
        ),
      onSuccess: log.onSuccess,
    });
    expect(starts).toBe(1);
    expect(text(target, "value")).toBe("100");

    inner.n = 200;
    flushSync();
    expect(starts).toBe(1);
    expect(text(target, "value")).toBe("100");

    // An invalidation still re-runs it, and the re-run sees the new state.
    reactivity.invalidate(["probe"]);
    expect(starts).toBe(2);
    await log.until((value) => String(value) === "100,200");

    await reactivity.dispose();
  });

  it("settles a failure to Failure, and starts over when a thunk's state changes", async () => {
    const reactivity = await makeReactivity();
    const dep = $state({ n: 1 });
    let starts = 0;
    const target = mountProbe({
      use: () =>
        useReactiveStream(
          () => ["probe"],
          () => {
            const n = dep.n;
            return Effect.suspend(() => {
              starts++;
              return n === 1 ? Effect.fail("boom") : Effect.succeed(n);
            });
          },
          { runtime: reactivity.runtime },
        ),
    });
    expect(starts).toBe(1);
    expect(text(target, "tag")).toBe("Failure");
    expect(text(target, "waiting")).toBe("false");

    // The failure ended the stream, so an invalidation no longer re-runs it.
    reactivity.invalidate(["probe"]);
    expect(starts).toBe(1);

    dep.n = 2;
    flushSync();
    expect(starts).toBe(2);
    expect(text(target, "tag")).toBe("Success");
    expect(text(target, "value")).toBe("2");

    await reactivity.dispose();
  });

  it("interrupts the previous run when it restarts, and the last run on unmount", async () => {
    const reactivity = await makeReactivity();
    const dep = $state({ n: 1 });
    const interrupted = [
      Effect.runSync(Deferred.make<void>()),
      Effect.runSync(Deferred.make<void>()),
    ] as const;
    let starts = 0;
    const target = document.createElement("div");
    document.body.appendChild(target);
    const component = mount(ResultProbe, {
      target,
      props: {
        use: () =>
          useReactiveStream(
            () => ["probe", dep.n],
            () => {
              const gate = interrupted[dep.n - 1]!;
              return Effect.suspend(() => {
                starts++;
                return Effect.never;
              }).pipe(Effect.onInterrupt(() => Deferred.succeed(gate, undefined)));
            },
            { runtime: reactivity.runtime },
          ),
      },
    });
    flushSync();
    expect(starts).toBe(1);

    dep.n = 2;
    flushSync();
    expect(starts).toBe(2);
    await Effect.runPromise(Deferred.await(interrupted[0]));
    expect(Effect.runSync(Deferred.isDone(interrupted[1]))).toBe(false);

    await unmount(component);
    target.remove();
    await Effect.runPromise(Deferred.await(interrupted[1]));
    expect(starts).toBe(2);

    await reactivity.dispose();
  });
});

describe("useInvalidateKeys", () => {
  it("can be called from an $effect without tracking the state the queries read", async () => {
    const managed = ManagedRuntime.make(Reactivity.layer);
    const reactivity = await managed.context();
    const inner = $state({ n: 1 });
    let starts = 0;
    let runs = 0;
    mountProbe({
      use: () => {
        const query = useReactiveQuery(
          () => ["probe"],
          () =>
            Effect.sync(() => {
              starts++;
              return inner.n;
            }),
          { runtime: reactivity },
        );
        const invalidate = useInvalidateKeys({ runtime: reactivity });
        // Created after the query's `$effect`, so the query is registered by
        // the time this runs, and the invalidation re-runs it synchronously.
        $effect(() => {
          runs++;
          invalidate(["probe"]);
        });
        return query;
      },
    });
    expect(runs).toBe(1);
    expect(starts).toBe(2);

    inner.n = 2;
    flushSync();
    expect(runs).toBe(1);
    expect(starts).toBe(2);

    mounter.cleanup();
    await managed.dispose();
  });
});

describe("makeResult", () => {
  // Isolates the untracked read in `failCause` (it reads the previous result to
  // carry a success forward); the hooks above also untrack their fork, so they
  // cannot tell whether this one read is tracked.
  it("failCause can be called from an $effect without re-running it", () => {
    let runs = 0;
    const target = mountProbe({
      use: () => {
        const state = makeResult<number, string>();
        $effect(() => {
          runs++;
          state.failCause(Cause.fail("boom"));
        });
        return state;
      },
    });

    expect(runs).toBe(1);
    expect(text(target, "tag")).toBe("Failure");
  });
});

describe("deprecated reactiveX aliases", () => {
  it("are the useReactiveX hooks under their old names, exported from the package root", async () => {
    // Import the root entry to check the published names, not just the module.
    const root = await import("../../src/index.js");
    expect(root.reactiveQuery).toBe(root.useReactiveQuery);
    expect(root.reactiveStream).toBe(root.useReactiveStream);
    expect(root.reactiveMutation).toBe(root.useReactiveMutation);
    expect(root.useReactiveQuery).toBe(useReactiveQuery);
    expect(root.useReactiveStream).toBe(useReactiveStream);
  });
});
