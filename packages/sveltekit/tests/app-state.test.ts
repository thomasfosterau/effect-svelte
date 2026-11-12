import { it } from "@effect/vitest";
import { assert, describe, expect } from "vite-plus/test";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import {
  type ReadonlyNavigating,
  type ReadonlyPage,
  type Watch,
  UpdateCheckError,
  checkForUpdateWith,
  makeCurrentPage,
  pageSnapshotStream,
  snapshotNavigating,
  snapshotPage,
  watchedStream,
} from "../src/internal/app-state.js";
import { ForeignError } from "./fixtures/foreign-error.js";

const makePage = (pathname: string): ReadonlyPage => ({
  url: new URL(`https://example.com${pathname}`),
  params: { slug: "x" },
  route: { id: "/blog/[slug]" },
  status: 200,
  error: null,
  data: { hello: "world" },
  state: {},
  form: undefined,
  shallow: null,
});

describe("snapshotPage", () => {
  it("copies the snapshotted fields off the (mutating) page proxy", () => {
    const page = makePage("/a");
    const snap = snapshotPage(page);
    expect(snap).toEqual({
      url: page.url,
      params: page.params,
      route: page.route,
      status: page.status,
      error: page.error,
      data: page.data,
      state: page.state,
      form: page.form,
      shallow: page.shallow,
    });
    // A shallow copy, not the same object.
    expect(snap).not.toBe(page);
  });
});

describe("pageSnapshotStream", () => {
  it.effect("emits the current page immediately, then after each navigation", () =>
    Effect.gen(function* () {
      let current = makePage("/a");
      let fire!: () => void;

      const stream = pageSnapshotStream<ReadonlyPage>(
        (callback) => {
          fire = callback;
        },
        () => current,
      );

      // Simulate two navigations, mutating the "page" between them.
      current = makePage("/b");
      fire();
      current = makePage("/c");
      fire();

      // Initial snapshot (/a) + one per navigation (/b, /c).
      const snaps = yield* Stream.runCollect(Stream.take(stream, 3));
      expect(snaps.map((s) => s.url.pathname)).toEqual(["/a", "/b", "/c"]);
    }),
  );

  it("registers the afterNavigate callback eagerly", () => {
    let registered = false;
    pageSnapshotStream<ReadonlyPage>(
      () => {
        registered = true;
      },
      () => makePage("/a"),
    );
    expect(registered).toBe(true);
  });
});

/**
 * A hand-driven stand-in for `watch.svelte.ts`: `emit()` re-runs every live
 * watcher's `read`, the way a Svelte flush re-runs a dirty `$effect`.
 */
const makeFakeWatch = () => {
  let live: ReadonlyArray<() => void> = [];
  let disposed = 0;
  const watch: Watch = (read, onValue) => {
    const run = () => onValue(read());
    live = Arr.append(live, run);
    run();
    return () => {
      live = Arr.filter(live, (other) => other !== run);
      disposed += 1;
    };
  };
  return {
    watch,
    emit: () => {
      Arr.forEach(live, (run) => run());
    },
    get live() {
      return live.length;
    },
    get disposed() {
      return disposed;
    },
  };
};

describe("watchedStream", () => {
  it.effect("emits the current value, then each re-read, and disposes the watcher on end", () =>
    Effect.gen(function* () {
      const fake = makeFakeWatch();
      let n = 0;
      const result = yield* Effect.gen(function* () {
        const values: Array<number> = [];
        yield* watchedStream(fake.watch, () => n).pipe(
          Stream.take(3),
          Stream.runForEach((value) =>
            Effect.sync(() => {
              values.push(value);
              // Drive the next "flush" only after the previous value arrived.
              n += 1;
              fake.emit();
            }),
          ),
        );
        return values;
      });
      expect(result).toEqual([0, 1, 2]);
      expect(fake.live).toBe(0);
      expect(fake.disposed).toBe(1);
    }),
  );

  it("is cold: nothing is watched until the stream runs", () => {
    const fake = makeFakeWatch();
    watchedStream(fake.watch, () => 1);
    expect(fake.live).toBe(0);
  });

  it.live("dies with what a throwing `watch` threw, instead of hanging", () => {
    const thrown = new ForeignError("watch failed");
    const throwingWatch: Watch = () => {
      throw thrown;
    };

    return Effect.gen(function* () {
      // `Stream.callback` forwards a failed setup to the stream from effect 4.0.2;
      // `failQueueOnSetupError` does it on 4.0.0 / 4.0.1, inside the `^4.0.0` peer
      // range. The timeout only guards against a regression to a hang, so
      // it fails the test rather than passing it.
      const exit = yield* watchedStream(throwingWatch, () => 1).pipe(
        Stream.runCollect,
        Effect.timeout("2 seconds"),
        Effect.exit,
      );

      assert(Exit.isFailure(exit), "expected the stream to die");
      const [reason, ...rest] = exit.cause.reasons;
      expect(rest).toEqual([]);
      assert(
        reason !== undefined && Cause.isDieReason(reason),
        `expected a defect, got ${Cause.pretty(exit.cause)}`,
      );
      expect(reason.defect).toBe(thrown);
    });
  });
});

const idle: ReadonlyNavigating = {
  type: null,
  from: null,
  to: null,
  willUnload: null,
  delta: null,
  complete: null,
};

describe("snapshotNavigating", () => {
  it("is None while no navigation is in flight", () => {
    expect(Option.isNone(snapshotNavigating(idle))).toBe(true);
  });

  it("copies an in-flight navigation into a plain snapshot", () => {
    const complete = Promise.resolve();
    const navigating: ReadonlyNavigating = {
      type: "popstate",
      from: null,
      to: null,
      willUnload: false,
      delta: -1,
      complete,
    };
    const snap = snapshotNavigating(navigating);
    expect(snap).toEqual(
      Option.some({
        type: "popstate",
        from: null,
        to: null,
        willUnload: false,
        delta: -1,
        complete,
      }),
    );
    assert(Option.isSome(snap), "expected a snapshot");
    expect(snap.value).not.toBe(navigating);
  });

  it("normalises a missing delta to null", () => {
    const snap = snapshotNavigating({
      type: "link",
      from: null,
      to: null,
      willUnload: false,
      complete: Promise.resolve(),
    });
    assert(Option.isSome(snap), "expected a snapshot");
    expect(snap.value.delta).toBeNull();
  });
});

describe("checkForUpdateWith", () => {
  it.effect("succeeds with the check's result", () =>
    Effect.gen(function* () {
      expect(yield* checkForUpdateWith(() => Promise.resolve(true))).toBe(true);
    }),
  );

  it.effect("fails with UpdateCheckError when the check rejects", () =>
    Effect.gen(function* () {
      const boom = new ForeignError("no window");
      const exit = yield* Effect.exit(checkForUpdateWith(() => Promise.reject(boom)));
      expect(exit).toEqual(Exit.fail(new UpdateCheckError({ cause: boom })));
    }),
  );

  it.effect("fails with UpdateCheckError when the check throws synchronously", () => {
    const boom = new ForeignError("window is not defined");
    const check = (): Promise<boolean> => {
      throw boom;
    };
    return Effect.gen(function* () {
      const error = yield* Effect.flip(checkForUpdateWith(check));
      expect(error).toBeInstanceOf(UpdateCheckError);
      expect(error.cause).toBe(boom);
    });
  });
});

describe("makeCurrentPage", () => {
  it.effect("get snapshots the page at the time it runs", () =>
    Effect.gen(function* () {
      let current = makePage("/a");
      const service = makeCurrentPage(() => current, makeFakeWatch().watch);
      expect((yield* service.get).url.pathname).toBe("/a");
      current = makePage("/b");
      expect((yield* service.get).url.pathname).toBe("/b");
    }),
  );

  it.effect("changes streams snapshots as the watcher reports changes", () =>
    Effect.gen(function* () {
      const fake = makeFakeWatch();
      const pages = ["/a", "/b", "/c"];
      let i = 0;
      // Clamp: the tap after the last taken value still triggers one re-read.
      const pageAt = (n: number): string => {
        const page = pages[Math.min(n, 2)];
        assert(page !== undefined, "expected a page path");
        return page;
      };
      const service = makeCurrentPage(() => makePage(pageAt(i)), fake.watch);
      const seen = yield* service.changes.pipe(
        Stream.take(3),
        Stream.tap(() =>
          Effect.sync(() => {
            i += 1;
            fake.emit();
          }),
        ),
        Stream.map((page) => page.url.pathname),
        Stream.runCollect,
      );
      expect(seen).toEqual(["/a", "/b", "/c"]);
    }),
  );
});
