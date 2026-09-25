/**
 * The registry seam on the server (plain Node, no `window`): the implicit
 * registry is browser-only, so reaching it — directly or through
 * `invalidateAtomKeys` — throws a tagged `AtomRegistryUnavailable` rather than
 * silently building a per-request registry that would issue discarded fetches.
 */
import { describe, expect, it } from "vite-plus/test";
import {
  AtomRegistryUnavailable,
  getAtomRegistry,
  invalidateAtomKeys,
  makeAtomRegistry,
} from "../src/atom.svelte.js";

describe("atom registry on the server", () => {
  it("throws when the implicit registry is reached outside the browser", () => {
    expect(() => getAtomRegistry()).toThrow(AtomRegistryUnavailable);
    expect(() => getAtomRegistry()).toThrow(/browser-only/);
    expect(() => invalidateAtomKeys(["k"])).toThrow(AtomRegistryUnavailable);
  });

  it("still allows an explicit registry", () => {
    expect(() => invalidateAtomKeys(["k"], makeAtomRegistry())).not.toThrow();
  });
});
