import { describe, expect, it } from "vite-plus/test";
import { lazy } from "../src/internal/lazy.js";
import { ForeignError } from "./fixtures/foreign-error.js";

describe("lazy", () => {
  it("does not build until the first call", () => {
    let builds = 0;
    lazy(() => {
      builds += 1;
      return builds;
    });
    expect(builds).toBe(0);
  });

  it("builds once and returns the same value on every call", () => {
    let builds = 0;
    const get = lazy(() => {
      builds += 1;
      return { builds };
    });
    const first = get();
    expect(get()).toBe(first);
    expect(first).toEqual({ builds: 1 });
    expect(builds).toBe(1);
  });

  it("caches a value that is itself undefined", () => {
    let builds = 0;
    const get = lazy(() => {
      builds += 1;
    });
    get();
    get();
    expect(builds).toBe(1);
  });

  it("caches nothing when the build throws, so the next call retries", () => {
    let builds = 0;
    const get = lazy(() => {
      builds += 1;
      if (builds === 1) throw new ForeignError("first build fails");
      return builds;
    });
    expect(() => get()).toThrow("first build fails");
    expect(get()).toBe(2);
    expect(get()).toBe(2);
  });
});
