import { describe, expect, it } from "vite-plus/test";
import { Effect, Stream } from "effect";
import { type ReadonlyPage, pageSnapshotStream, snapshotPage } from "../src/internal/app-state.js";

const makePage = (pathname: string): ReadonlyPage => ({
  url: new URL(`https://example.com${pathname}`),
  params: { slug: "x" },
  route: { id: "/blog/[slug]" },
  status: 200,
  error: null,
  data: { hello: "world" },
  state: {},
  form: undefined,
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
