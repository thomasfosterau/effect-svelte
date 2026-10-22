/**
 * `State` against a rune-backed `$app/state` stand-in: these run the real
 * `watch.svelte.ts` (compiled by the Svelte plugin, client build), so they
 * check that the streams and `CurrentPage` follow actual rune changes. Svelte
 * flushes effects on a microtask after each write; every assertion waits for
 * the value it expects, so nothing depends on wall-clock time.
 */

import type { Navigation } from "$app/navigation";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { flushSync } from "svelte";
import { afterEach, assert, describe, expect, it } from "vite-plus/test";
import * as State from "../../src/State.js";
import {
  navigatingReads,
  setCheck,
  setNavigation,
  setPage,
  setUpdated,
} from "./fixtures/app-state.svelte.js";

/**
 * Runs `stream` in the background, forwarding each value to a queue the test
 * takes from — so a test can write, then wait for exactly the next emission.
 */
const subscribe = <A>(stream: Stream.Stream<A>) =>
  Effect.gen(function* () {
    const out = yield* Queue.unbounded<A>();
    const fiber = yield* stream.pipe(
      Stream.runForEach((value) => Queue.offer(out, value)),
      Effect.forkChild,
    );
    return { next: Queue.take(out), fiber };
  });

const navigation = (type: "link" | "goto", pathname: string): Navigation => {
  const base = {
    shallow: false,
    from: null,
    to: {
      params: {},
      route: { id: pathname },
      url: new URL(`https://example.com${pathname}`),
      scroll: null,
    },
    willUnload: false,
    complete: Promise.resolve(),
  };
  return type === "link" ? { ...base, type, event: new PointerEvent("click") } : { ...base, type };
};

afterEach(() => {
  setNavigation(null);
  setUpdated(false);
  setPage({ url: new URL("https://example.com/"), status: -1 });
  setCheck(() => Promise.resolve(false));
});

describe("State.navigating", () => {
  it("emits None when idle, Some while a navigation is in flight, then None again", async () => {
    const seen = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { next } = yield* subscribe(State.navigating());
          const idle = yield* next;

          setNavigation(navigation("link", "/about"));
          const active = yield* next;

          setNavigation(null);
          const done = yield* next;
          return { idle, active, done };
        }),
      ),
    );
    expect(Option.isNone(seen.idle)).toBe(true);
    assert(Option.isSome(seen.active), "expected a navigation in flight");
    const active = seen.active.value;
    expect(active.type).toBe("link");
    expect(active.to?.url.pathname).toBe("/about");
    expect(active.delta).toBeNull();
    expect(Option.isNone(seen.done)).toBe(true);
  });

  it("disposes its watcher once interrupted", async () => {
    const reads = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { next, fiber } = yield* subscribe(State.navigating());
          yield* next;
          yield* Fiber.interrupt(fiber);
          const before = navigatingReads();
          // With the root effect destroyed, a change re-runs nothing.
          setNavigation(navigation("goto", "/later"));
          flushSync();
          return { before, after: navigatingReads() };
        }),
      ),
    );
    expect(reads.after).toBe(reads.before);
  });
});

describe("State.updated", () => {
  it("emits the current flag, then the new one when it flips", async () => {
    const seen = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { next } = yield* subscribe(State.updated());
          const before = yield* next;
          setUpdated(true);
          const after = yield* next;
          return [before, after];
        }),
      ),
    );
    expect(seen).toEqual([false, true]);
  });
});

describe("State.checkForUpdate", () => {
  it("succeeds with updated.check()'s result", async () => {
    setCheck(() => Promise.resolve(true));
    await expect(Effect.runPromise(State.checkForUpdate())).resolves.toBe(true);
  });

  it("fails with UpdateCheckError when updated.check() rejects", async () => {
    const boom = new Error("no window");
    setCheck(() => Promise.reject(boom));
    const exit = await Effect.runPromiseExit(State.checkForUpdate());
    expect(exit).toEqual(Exit.fail(new State.UpdateCheckError({ cause: boom })));
  });
});

describe("State.CurrentPage", () => {
  it("reads the current page through the layer", async () => {
    setPage({ url: new URL("https://example.com/first"), status: 200 });
    const read = Effect.gen(function* () {
      const current = yield* State.CurrentPage;
      return yield* current.get;
    }).pipe(Effect.provide(State.CurrentPage.layer));

    expect((await Effect.runPromise(read)).url.pathname).toBe("/first");
    setPage({ url: new URL("https://example.com/second") });
    const second = await Effect.runPromise(read);
    expect(second.url.pathname).toBe("/second");
    expect(second.status).toBe(200);
  });

  it("streams a fresh snapshot whenever the page changes", async () => {
    const seen = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const current = yield* State.CurrentPage;
          const { next } = yield* subscribe(current.changes);
          const first = yield* next;

          // A navigation assigns several fields at once: one emission.
          setPage({ url: new URL("https://example.com/next"), status: 404, error: "nope" });
          const navigated = yield* next;

          // Shallow routing changes `state` without a navigation.
          setPage({ state: { modal: true } });
          const shallow = yield* next;
          return { first, navigated, shallow };
        }),
      ).pipe(Effect.provide(State.CurrentPage.layer)),
    );
    expect(seen.first.url.pathname).toBe("/");
    expect(seen.navigated).toMatchObject({ status: 404, error: "nope" });
    expect(seen.navigated.url.pathname).toBe("/next");
    expect(seen.shallow.state).toEqual({ modal: true });
    expect(seen.shallow.url.pathname).toBe("/next");
  });

  it("can be replaced with a test layer", async () => {
    const snapshot = await Effect.runPromise(
      Effect.gen(function* () {
        const current = yield* State.CurrentPage;
        return yield* current.get;
      }).pipe(Effect.provide(State.CurrentPage.layer)),
    );
    const fake = Layer.succeed(State.CurrentPage, {
      get: Effect.succeed({ ...snapshot, url: new URL("https://example.com/fake") }),
      changes: Stream.empty,
    });
    const page = await Effect.runPromise(
      Effect.gen(function* () {
        const current = yield* State.CurrentPage;
        return yield* current.get;
      }).pipe(Effect.provide(fake)),
    );
    expect(page.url.pathname).toBe("/fake");
  });
});
