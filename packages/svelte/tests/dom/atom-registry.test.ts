/**
 * The registry seam in the browser: the implicit registry is memoised, and
 * `invalidateAtomKeys` is a no-op when nothing is mounted against the keys.
 * (Ported from the website application's `atom-registry` suite; the server half
 * lives in `tests/atom-registry.test.ts`.)
 */
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";
import { getAtomRegistry, invalidateAtomKeys, makeAtomRegistry } from "../../src/atom.svelte.js";

describe("getAtomRegistry (browser)", () => {
  it("memoises the implicit registry across calls", () => {
    expect(getAtomRegistry()).toBe(getAtomRegistry());
  });
});

describe("makeAtomRegistry", () => {
  it("builds independent registries", () => {
    expect(makeAtomRegistry()).not.toBe(makeAtomRegistry());
  });

  it("honours initialValues", async () => {
    const { Atom } = await import("effect/unstable/reactivity");
    const atom = Atom.make(1);
    const registry = makeAtomRegistry({ initialValues: [[atom, 5]], defaultIdleTTL: 1_000 });
    expect(registry.get(atom)).toBe(5);
    expect(AsyncResult.isInitial(AsyncResult.initial())).toBe(true);
    registry.dispose();
  });
});

describe("invalidateAtomKeys", () => {
  it("is a no-op when nothing is mounted against the given keys", () => {
    expect(() => invalidateAtomKeys(["nobody-is-listening"])).not.toThrow();
    expect(() => invalidateAtomKeys({ family: ["nobody"] }, makeAtomRegistry())).not.toThrow();
  });
});
