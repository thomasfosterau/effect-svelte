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
 * spot, so calling it from an `$effect` must not track their reads either;
 * nor may `useReactiveMutation`'s `run()` or `useMutation`'s `mutate()`, which
 * also call thunks and callbacks and run the mutation up to its first async
 * step (#142).
 *
 * Synchronous Effects settle inside the `$effect`, so `flushSync()` after
 * `mount` is enough to see the settled result; asynchronous ones are released
 * and observed through `Deferred`s and the probe's `onSuccess`, never a timer.
 */
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { Reactivity } from "effect/reactivity";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { flushSync, mount, unmount } from "svelte";
import { it } from "@effect/vitest";
import { afterEach, assert, describe, expect } from "vite-plus/test";
import { useDerived } from "../../src/derived.svelte.js";
import { useEffect } from "../../src/effect.svelte.js";
import { makeResult } from "../../src/internal/result.svelte.js";
import { useQuery } from "../../src/query.svelte.js";
import { useMutation } from "../../src/mutation.svelte.js";
import { useScope, type ScopeRef } from "../../src/scope.svelte.js";
import { useStream } from "../../src/stream.svelte.js";
import { usePubSub } from "../../src/subscription.svelte.js";
import {
  useReactiveQuery,
  useReactiveStream,
  useReactiveMutation,
  useInvalidateKeys,
  type UseReactiveMutationReturn,
} from "../../src/reactivity.svelte.js";
import ResultProbe from "./ResultProbe.svelte";
import { makeMounter, text } from "./helpers.js";

const mounter = makeMounter();
afterEach(mounter.cleanup);

const runtime = Context.empty();

/** Mounts the probe and runs the hook's mount effects synchronously. */
interface ProbeProps<A, E> {
  readonly use: () => { readonly current: AsyncResult.AsyncResult<A, E> };
  readonly onSuccess?: (value: A) => void;
  readonly onFailure?: () => void;
}

const mountProbe = <A, E>(props: ProbeProps<A, E>) => {
  const target = mounter.mount<ProbeProps<A, E>>(ResultProbe, props);
  flushSync();
  return target;
};

/** A promise that resolves with the first value the probe reports as `Success`. */
const nextSuccess = <A>() => {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((r) => (resolve = r));
  return { promise, onSuccess: (value: A) => resolve(value) };
};

/**
 * Records every value the probe reports as `Success` (a waiting `Success`
 * included); `until` resolves once one matches, even if it already arrived.
 */
const successLog = <A>() => {
  const values: Array<A> = [];
  const waiters: Array<{ match: (value: A) => boolean; resolve: () => void }> = [];
  return {
    values,
    onSuccess: (value: A) => {
      values.push(value);
      Arr.forEach(waiters.splice(0), (waiter) => {
        if (waiter.match(value)) waiter.resolve();
        else waiters.push(waiter);
      });
    },
    until: (match: (value: A) => boolean): Promise<void> =>
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
    expect(text(target, "tag")).toEqual(Option.some("Success"));
    expect(text(target, "waiting")).toEqual(Option.some("false"));
    expect(text(target, "value")).toEqual(Option.some("1"));
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
    expect(text(target, "tag")).toEqual(Option.some("Failure"));
  });

  it.effect("runs an asynchronous Effect once, then settles to Success", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<number>();
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
      expect(text(target, "tag")).toEqual(Option.some("Initial"));
      expect(text(target, "waiting")).toEqual(Option.some("true"));

      yield* Deferred.succeed(gate, 42);
      expect(yield* Effect.tryPromise(() => success.promise)).toBe(42);
      flushSync();

      expect(starts).toBe(1);
      expect(text(target, "tag")).toEqual(Option.some("Success"));
      expect(text(target, "waiting")).toEqual(Option.some("false"));
    }),
  );

  it.effect("interrupts the running Effect on unmount", () =>
    Effect.gen(function* () {
      const interrupted = yield* Deferred.make<void>();
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

      yield* Effect.tryPromise(() => unmount(component));
      target.remove();

      yield* Deferred.await(interrupted);
      expect(starts).toBe(1);
    }),
  );

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
    expect(text(target, "value")).toEqual(Option.some("1"));

    box.n = 2;
    flushSync();

    expect(starts).toBe(1);
    expect(text(target, "value")).toEqual(Option.some("1"));
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
          hook.setData((previous) => Option.getOrElse(previous, () => 0) + 1);
        });
        return hook;
      },
    });

    expect(writes).toBe(1);
    expect(text(target, "tag")).toEqual(Option.some("Success"));
    expect(text(target, "value")).toEqual(Option.some("1"));
  });
});

/** A hook's `setData`, as the probes of "setData updater" capture it. */
type SetData = (updater: (previous: Option.Option<number>) => number) => void;

describe("setData updater", () => {
  it("receives None before the first value, then Some with the current one", () => {
    const seen: Array<Option.Option<number>> = [];
    const record = (previous: Option.Option<number>): number => {
      seen.push(previous);
      return Option.getOrElse(previous, () => 10) + 1;
    };
    let setData = Option.none<SetData>();
    const target = mountProbe({
      use: () => {
        // Not `immediate`: the result stays `Initial` until `setData` writes it.
        const hook = useEffect(Effect.succeed(0), { runtime });
        setData = Option.some(hook.setData);
        return hook;
      },
    });
    expect(text(target, "tag")).toEqual(Option.some("Initial"));

    assert(Option.isSome(setData), "the probe did not run `use`");
    setData.value(record);
    setData.value(record);
    flushSync();

    expect(seen).toEqual([Option.none(), Option.some(11)]);
    expect(text(target, "value")).toEqual(Option.some("12"));
  });

  it("useQuery's updater receives Some with the fetched value", () => {
    const seen: Array<Option.Option<number>> = [];
    let setData = Option.none<SetData>();
    const target = mountProbe({
      use: () => {
        const hook = useQuery(Effect.succeed(5), { runtime });
        setData = Option.some(hook.setData);
        return hook;
      },
    });
    expect(text(target, "value")).toEqual(Option.some("5"));

    assert(Option.isSome(setData), "the probe did not run `use`");
    setData.value((previous) => {
      seen.push(previous);
      return Option.getOrElse(previous, () => 0) * 2;
    });
    flushSync();

    expect(seen).toEqual([Option.some(5)]);
    expect(text(target, "value")).toEqual(Option.some("10"));
  });
});

describe("latest", () => {
  it("useStream: None until the first emission, then Some with the last one", async () => {
    const log = successLog<ReadonlyArray<number>>();
    const seen: Array<Option.Option<number>> = [];
    mountProbe({
      use: () => {
        const hook = useStream(Stream.make(1, 2, 3), { runtime });
        // Read outside an effect: the stream has not started.
        seen.push(hook.latest);
        $effect(() => {
          seen.push(hook.latest);
        });
        return hook;
      },
      onSuccess: log.onSuccess,
    });
    await log.until((values) => values.length === 3);
    flushSync();

    expect(seen[0]).toEqual(Option.none());
    expect(Arr.last(seen)).toEqual(Option.some(Option.some(3)));
  });

  it("useStream: stays None for a stream that never emits", () => {
    const seen: Array<Option.Option<number>> = [];
    mountProbe({
      use: () => {
        const hook = useStream(Stream.never, { runtime });
        $effect(() => {
          seen.push(hook.latest);
        });
        return hook;
      },
    });

    expect(seen).toEqual([Option.none()]);
  });

  it.effect("usePubSub: None until a message arrives, then Some with the last one", () =>
    Effect.gen(function* () {
      // `replay` hands the subscriber the message published before it connected.
      const pubsub = yield* PubSub.unbounded<string>({ replay: 1 });
      const seen: Array<Option.Option<string>> = [];
      mountProbe({
        use: () => {
          const hook = usePubSub(pubsub, { runtime });
          seen.push(hook.latest);
          $effect(() => {
            seen.push(hook.latest);
          });
          return { current: AsyncResult.initial() };
        },
      });
      expect(seen[0]).toEqual(Option.none());

      PubSub.publishUnsafe(pubsub, "first");
      yield* Effect.tryPromise(async () => {
        await expect.poll(() => Arr.last(seen)).toEqual(Option.some(Option.some("first")));
      });
      PubSub.publishUnsafe(pubsub, "second");
      yield* Effect.tryPromise(async () => {
        await expect.poll(() => Arr.last(seen)).toEqual(Option.some(Option.some("second")));
      });
    }),
  );
});

describe("useScope", () => {
  it.effect(
    "is None during initialisation, Some once mounted, and closes that scope on unmount",
    () =>
      Effect.gen(function* () {
        let ref: ScopeRef = { current: Option.none() };
        const duringInit: Array<Option.Option<unknown>> = [];
        mountProbe({
          use: () => {
            ref = useScope();
            duringInit.push(ref.current);
            return { current: AsyncResult.initial() };
          },
        });
        expect(duringInit).toEqual([Option.none()]);

        const scope = ref.current;
        assert(Option.isSome(scope));
        let closed = false;
        yield* Scope.addFinalizer(
          scope.value,
          Effect.sync(() => {
            closed = true;
          }),
        );
        expect(closed).toBe(false);

        mounter.cleanup();
        expect(closed).toBe(true);
      }),
  );
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
    expect(text(target, "tag")).toEqual(Option.some("Success"));
    expect(text(target, "value")).toEqual(Option.some("1"));
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
    expect(text(target, "tag")).toEqual(Option.some("Success"));
    expect(text(target, "value")).toEqual(Option.some("10"));

    box.n = 2;
    flushSync();

    expect(starts).toBe(2);
    expect(text(target, "value")).toEqual(Option.some("20"));
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
    expect(text(target, "value")).toEqual(Option.some("101"));

    // Read only inside the Effect: not a dependency, so no restart.
    inner.n = 200;
    flushSync();
    expect(starts).toBe(1);
    expect(text(target, "value")).toEqual(Option.some("101"));

    // Read by the thunk: a dependency, so the run restarts (and sees `inner`).
    dep.n = 2;
    flushSync();
    expect(starts).toBe(2);
    expect(text(target, "value")).toEqual(Option.some("202"));
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
    expect(text(target, "tag")).toEqual(Option.some("Success"));
    expect(text(target, "waiting")).toEqual(Option.some("false"));

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
    expect(text(target, "value")).toEqual(Option.some("101"));

    // Read by the thunks: a dependency, so the query restarts (and sees `inner`).
    dep.n = 2;
    flushSync();
    expect(starts).toBe(2);
    await log.until((value) => value === 202);
    flushSync();
    expect(text(target, "tag")).toEqual(Option.some("Success"));
    expect(text(target, "waiting")).toEqual(Option.some("false"));
    expect(text(target, "value")).toEqual(Option.some("202"));

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
    expect(text(target, "tag")).toEqual(Option.some("Failure"));
    expect(text(target, "waiting")).toEqual(Option.some("false"));

    mounter.cleanup();
    await managed.dispose();
  });
});

/** A `Reactivity` runtime plus a synchronous `invalidate` for the tests. */
const makeReactivity = async () => {
  const managed = ManagedRuntime.make(Reactivity.layer);
  const context = await managed.context();
  return {
    runtime: context,
    invalidate: (keys: ReadonlyArray<unknown>) => managed.runSync(Reactivity.invalidate(keys)),
    dispose: async () => {
      mounter.cleanup();
      await managed.dispose();
    },
  };
};

describe("useReactiveStream", () => {
  // `useReactiveStream` is built on `createSubscriber`, whose `start` runs
  // untracked: the thunks must be tracked some other way (#140).

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
    expect(text(target, "tag")).toEqual(Option.some("Success"));
    expect(text(target, "value")).toEqual(Option.some("1"));

    // A re-run's value reaches the stream after an async boundary.
    reactivity.invalidate(["probe"]);
    expect(starts).toBe(2);
    await log.until((value) => String(value) === "1,2");
    flushSync();
    expect(starts).toBe(2);
    expect(text(target, "value")).toEqual(Option.some("1,2"));

    await reactivity.dispose();
  });

  it("exposes the most recent value as `latest`: None before the run starts, then Some", async () => {
    const reactivity = await makeReactivity();
    const log = successLog();
    const seen: Array<Option.Option<number>> = [];
    let starts = 0;
    mountProbe({
      use: () => {
        const hook = useReactiveStream(
          () => ["latest"],
          () => Effect.sync(() => ++starts),
          { runtime: reactivity.runtime },
        );
        // Read outside an effect: the stream has not started.
        seen.push(hook.latest);
        $effect(() => {
          seen.push(hook.latest);
        });
        return hook;
      },
      onSuccess: log.onSuccess,
    });
    expect(seen[0]).toEqual(Option.none());
    expect(Arr.last(seen)).toEqual(Option.some(Option.some(1)));

    reactivity.invalidate(["latest"]);
    await log.until((value) => String(value) === "1,2");
    flushSync();
    expect(Arr.last(seen)).toEqual(Option.some(Option.some(2)));

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
    expect(text(target, "value")).toEqual(Option.some("1"));

    dep.n = 2;
    flushSync();
    // A fresh run: the values emitted under the old keys are dropped.
    expect(starts).toBe(2);
    expect(text(target, "value")).toEqual(Option.some("2"));

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
    expect(text(target, "value")).toEqual(Option.some("10"));

    dep.n = 2;
    flushSync();
    expect(starts).toBe(2);
    expect(text(target, "value")).toEqual(Option.some("20"));

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
    expect(text(target, "value")).toEqual(Option.some("100"));

    inner.n = 200;
    flushSync();
    expect(starts).toBe(1);
    expect(text(target, "value")).toEqual(Option.some("100"));

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
    expect(text(target, "tag")).toEqual(Option.some("Failure"));
    expect(text(target, "waiting")).toEqual(Option.some("false"));

    // The failure ended the stream, so an invalidation no longer re-runs it.
    reactivity.invalidate(["probe"]);
    expect(starts).toBe(1);

    dep.n = 2;
    flushSync();
    expect(starts).toBe(2);
    expect(text(target, "tag")).toEqual(Option.some("Success"));
    expect(text(target, "value")).toEqual(Option.some("2"));

    await reactivity.dispose();
  });

  it.effect("interrupts the previous run when it restarts, and the last run on unmount", () =>
    Effect.gen(function* () {
      const reactivity = yield* Effect.tryPromise(() => makeReactivity());
      const dep = $state({ n: 1 });
      const interrupted = [yield* Deferred.make<void>(), yield* Deferred.make<void>()] as const;
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
                const gate = interrupted[dep.n - 1];
                assert.isDefined(gate);
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
      yield* Deferred.await(interrupted[0]);
      expect(yield* Deferred.isDone(interrupted[1])).toBe(false);

      yield* Effect.tryPromise(() => unmount(component));
      target.remove();
      yield* Deferred.await(interrupted[1]);
      expect(starts).toBe(2);

      yield* Effect.tryPromise(() => reactivity.dispose());
    }),
  );
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

describe("useReactiveMutation", () => {
  it("runs on run(), settles to Success and re-runs the queries on its keys", async () => {
    const managed = ManagedRuntime.make(Reactivity.layer);
    const reactivity = await managed.context();
    let queries = 0;
    let mutations = 0;
    let mutation!: UseReactiveMutationReturn<number, never>;
    const target = mountProbe({
      use: () => {
        useReactiveQuery(
          () => ["probe"],
          () => Effect.sync(() => ++queries),
          { runtime: reactivity },
        );
        mutation = useReactiveMutation(
          ["probe"],
          Effect.sync(() => ++mutations),
          { runtime: reactivity },
        );
        return mutation;
      },
    });
    expect(queries).toBe(1);
    expect(mutations).toBe(0);
    expect(text(target, "tag")).toEqual(Option.some("Initial"));
    expect(text(target, "waiting")).toEqual(Option.some("false"));

    mutation.run();
    flushSync();
    expect(mutations).toBe(1);
    expect(queries).toBe(2);
    expect(text(target, "tag")).toEqual(Option.some("Success"));
    expect(text(target, "waiting")).toEqual(Option.some("false"));
    expect(text(target, "value")).toEqual(Option.some("1"));

    mounter.cleanup();
    await managed.dispose();
  });

  it("settles a failure to Failure without invalidating its keys", async () => {
    const managed = ManagedRuntime.make(Reactivity.layer);
    const reactivity = await managed.context();
    let queries = 0;
    let mutation!: UseReactiveMutationReturn<never, string>;
    const target = mountProbe({
      use: () => {
        useReactiveQuery(
          () => ["probe"],
          () => Effect.sync(() => ++queries),
          { runtime: reactivity },
        );
        mutation = useReactiveMutation(["probe"], Effect.fail("boom"), { runtime: reactivity });
        return mutation;
      },
    });
    expect(queries).toBe(1);

    mutation.run();
    flushSync();
    expect(queries).toBe(1);
    expect(text(target, "tag")).toEqual(Option.some("Failure"));
    expect(text(target, "waiting")).toEqual(Option.some("false"));

    mounter.cleanup();
    await managed.dispose();
  });

  it("can run from an $effect without tracking the state the mutation or the re-run queries read", async () => {
    const managed = ManagedRuntime.make(Reactivity.layer);
    const reactivity = await managed.context();
    const keysDep = $state({ n: 1 });
    const effectDep = $state({ n: 1 });
    const inner = $state({ n: 1 });
    const queried = $state({ n: 1 });
    let queries = 0;
    let mutations = 0;
    let runs = 0;
    const target = mountProbe({
      use: () => {
        useReactiveQuery(
          () => ["probe"],
          () =>
            Effect.sync(() => {
              queries++;
              return queried.n;
            }),
          { runtime: reactivity },
        );
        const mutation = useReactiveMutation(
          () => (keysDep.n > 0 ? ["probe"] : []),
          () => {
            const n = effectDep.n;
            return Effect.sync(() => {
              mutations++;
              return n + inner.n;
            });
          },
          { runtime: reactivity },
        );
        // Created after the query's `$effect`, so the query is registered by
        // the time this runs, and the mutation's invalidation re-runs it
        // synchronously.
        $effect(() => {
          runs++;
          mutation.run();
        });
        return mutation;
      },
    });
    expect(runs).toBe(1);
    expect(mutations).toBe(1);
    expect(queries).toBe(2);
    expect(text(target, "tag")).toEqual(Option.some("Success"));
    expect(text(target, "value")).toEqual(Option.some("2"));

    // Read by the keys thunk, the effect thunk, the mutation Effect and the
    // re-run query: none of them is the caller's dependency.
    Arr.forEach([keysDep, effectDep, inner, queried], (box) => {
      box.n++;
      flushSync();
      expect(runs).toBe(1);
    });
    expect(mutations).toBe(1);
    expect(queries).toBe(2);

    mounter.cleanup();
    await managed.dispose();
  });
});

describe("useMutation", () => {
  it("can mutate from an $effect without tracking the state the mutation or the re-run queries read", async () => {
    const managed = ManagedRuntime.make(Reactivity.layer);
    const reactivity = await managed.context();
    const fnDep = $state({ n: 1 });
    const inner = $state({ n: 1 });
    const callbackDep = $state({ n: 1 });
    const queried = $state({ n: 1 });
    let queries = 0;
    let mutations = 0;
    let runs = 0;
    const target = mountProbe({
      use: () => {
        useReactiveQuery(
          () => ["probe"],
          () =>
            Effect.sync(() => {
              queries++;
              return queried.n;
            }),
          { runtime: reactivity },
        );
        const mutation = useMutation(
          (input: number) => {
            const n = fnDep.n;
            return Effect.sync(() => {
              mutations++;
              return input + n + inner.n;
            });
          },
          {
            runtime: reactivity,
            onMutate: () => callbackDep.n,
            onSuccess: () => void callbackDep.n,
            onSettled: () => void callbackDep.n,
            invalidates: () => (callbackDep.n > 0 ? ["probe"] : []),
          },
        );
        $effect(() => {
          runs++;
          mutation.mutate(1);
        });
        return mutation;
      },
    });
    expect(runs).toBe(1);
    expect(mutations).toBe(1);
    expect(queries).toBe(2);
    expect(text(target, "tag")).toEqual(Option.some("Success"));
    expect(text(target, "value")).toEqual(Option.some("3"));

    // Read by `fn`, the mutation Effect, the callbacks and the re-run query:
    // none of them is the caller's dependency.
    Arr.forEach([fnDep, inner, callbackDep, queried], (box) => {
      box.n++;
      flushSync();
      expect(runs).toBe(1);
    });
    expect(mutations).toBe(1);
    expect(queries).toBe(2);

    mounter.cleanup();
    await managed.dispose();
  });

  it("can mutate from an $effect without tracking an onError callback's reads", async () => {
    const dep = $state({ n: 1 });
    let runs = 0;
    const target = mountProbe({
      use: () => {
        const mutation = useMutation((input: number) => Effect.fail(input), {
          runtime,
          onError: () => void dep.n,
        });
        $effect(() => {
          runs++;
          mutation.mutate(1);
        });
        return mutation;
      },
    });
    expect(runs).toBe(1);
    expect(text(target, "tag")).toEqual(Option.some("Failure"));

    dep.n++;
    flushSync();
    expect(runs).toBe(1);
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
    expect(text(target, "tag")).toEqual(Option.some("Failure"));
  });
});
