import { describe, expect, it } from "vite-plus/test";
import { Effect, Exit, Option, Stream } from "effect";
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
  it("emits the current page immediately, then after each navigation", async () => {
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
    const snaps = await Effect.runPromise(Stream.runCollect(Stream.take(stream, 3)));
    expect(snaps.map((s) => s.url.pathname)).toEqual(["/a", "/b", "/c"]);
  });

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
  const live = new Set<() => void>();
  let disposed = 0;
  const watch: Watch = (read, onValue) => {
    const run = () => onValue(read());
    live.add(run);
    run();
    return () => {
      live.delete(run);
      disposed += 1;
    };
  };
  return {
    watch,
    emit: () => {
      for (const run of live) run();
    },
    get live() {
      return live.size;
    },
    get disposed() {
      return disposed;
    },
  };
};

describe("watchedStream", () => {
  it("emits the current value, then each re-read, and disposes the watcher on end", async () => {
    const fake = makeFakeWatch();
    let n = 0;
    const result = await Effect.runPromise(
      Effect.gen(function* () {
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
      }),
    );
    expect(result).toEqual([0, 1, 2]);
    expect(fake.live).toBe(0);
    expect(fake.disposed).toBe(1);
  });

  it("is cold: nothing is watched until the stream runs", () => {
    const fake = makeFakeWatch();
    watchedStream(fake.watch, () => 1);
    expect(fake.live).toBe(0);
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
    if (Option.isSome(snap)) expect(snap.value).not.toBe(navigating);
  });

  it("normalises a missing delta to null", () => {
    const snap = snapshotNavigating({
      type: "link",
      from: null,
      to: null,
      willUnload: false,
      complete: Promise.resolve(),
    });
    expect(Option.getOrThrow(snap).delta).toBeNull();
  });
});

describe("checkForUpdateWith", () => {
  it("succeeds with the check's result", async () => {
    await expect(Effect.runPromise(checkForUpdateWith(() => Promise.resolve(true)))).resolves.toBe(
      true,
    );
  });

  it("fails with UpdateCheckError when the check rejects", async () => {
    const boom = new Error("no window");
    const exit = await Effect.runPromiseExit(checkForUpdateWith(() => Promise.reject(boom)));
    expect(exit).toEqual(Exit.fail(new UpdateCheckError({ cause: boom })));
  });

  it("fails with UpdateCheckError when the check throws synchronously", async () => {
    const boom = new Error("window is not defined");
    const error = await Effect.runPromise(
      Effect.flip(
        checkForUpdateWith(() => {
          throw boom;
        }),
      ),
    );
    expect(error).toBeInstanceOf(UpdateCheckError);
    expect(error.cause).toBe(boom);
  });
});

describe("makeCurrentPage", () => {
  it("get snapshots the page at the time it runs", async () => {
    let current = makePage("/a");
    const service = makeCurrentPage(() => current, makeFakeWatch().watch);
    expect((await Effect.runPromise(service.get)).url.pathname).toBe("/a");
    current = makePage("/b");
    expect((await Effect.runPromise(service.get)).url.pathname).toBe("/b");
  });

  it("changes streams snapshots as the watcher reports changes", async () => {
    const fake = makeFakeWatch();
    const pages = ["/a", "/b", "/c"];
    let i = 0;
    // Clamp: the tap after the last taken value still triggers one re-read.
    const service = makeCurrentPage(() => makePage(pages[Math.min(i, 2)]!), fake.watch);
    const seen = await Effect.runPromise(
      service.changes.pipe(
        Stream.take(3),
        Stream.tap(() =>
          Effect.sync(() => {
            i += 1;
            fake.emit();
          }),
        ),
        Stream.map((page) => page.url.pathname),
        Stream.runCollect,
      ),
    );
    expect(seen).toEqual(["/a", "/b", "/c"]);
  });
});
