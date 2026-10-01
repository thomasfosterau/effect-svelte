/**
 * The Svelte ↔ atom bridge (`useAtomResult` / `useAtom` / `invalidateAtomKeys`),
 * ported from the website application's `atom-bridge` suite. Three properties
 * matter, and none is visible in a type:
 *
 * 1. **A read subscribes**, so the value re-renders when the registry
 *    re-evaluates the atom — not only on the first read.
 * 2. **`invalidateAtomKeys` reaches the same `Reactivity` instance the query
 *    atoms register against**, and only the atoms registered against the given
 *    keys. Build the reactivity service through a different memo map and every
 *    call still type-checks, still runs, and silently refreshes nothing.
 * 3. **The hook follows its thunk.** A query atom is identified by its request,
 *    so a paged view names a different atom per window.
 */
import { Effect } from "effect";
import { Atom } from "effect/reactivity";
import { tick } from "svelte";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { getAtomRegistry, invalidateAtomKeys, makeAtomRegistry } from "../../src/atom.svelte.js";
import AtomProbe from "./AtomProbe.svelte";
import WritableAtomProbe from "./WritableAtomProbe.svelte";
import { flush, makeMounter, text } from "./helpers.js";

const mounter = makeMounter();
afterEach(mounter.cleanup);

/**
 * An atom that reports how many times it has been evaluated, refreshed by `keys`
 * — the same `withReactivity` wrapper `AtomHttpApi.query` applies to a request
 * given `reactivityKeys`.
 */
const countingAtom = (keys: ReadonlyArray<unknown>) => {
  let runs = 0;
  return Atom.withReactivity(keys)(Atom.make(Effect.sync(() => `run-${++runs}`)));
};

/** `select` for a probe that always reads one fixed atom. */
const fixed = (atom: Atom.Atom<never>) => () => atom;

describe("useAtomResult", () => {
  it("renders the atom's settled value", async () => {
    const target = mounter.mount(AtomProbe, { select: fixed(countingAtom(["render"]) as never) });

    await expect.poll(() => text(target, "atom-state")).toBe("run-1");
  });

  it("renders loading until an async atom settles", async () => {
    const atom = Atom.make(Effect.sleep("20 millis").pipe(Effect.as("late")));
    const target = mounter.mount(AtomProbe, { select: fixed(atom as never) });
    await flush();

    expect(text(target, "atom-state")).toBe("loading");
    await expect.poll(() => text(target, "atom-state")).toBe("late");
  });

  it("re-reads when invalidateAtomKeys invalidates the atom's keys", async () => {
    const target = mounter.mount(AtomProbe, {
      select: fixed(countingAtom(["invalidate"]) as never),
    });
    await expect.poll(() => text(target, "atom-state")).toBe("run-1");

    invalidateAtomKeys(["invalidate"]);

    await expect.poll(() => text(target, "atom-state")).toBe("run-2");
  });

  it("leaves an atom registered against other keys alone", async () => {
    const scoped = mounter.mount(AtomProbe, { select: fixed(countingAtom(["scoped"]) as never) });
    const sentinel = mounter.mount(AtomProbe, {
      select: fixed(countingAtom(["some-other-family"]) as never),
    });
    await expect.poll(() => text(scoped, "atom-state")).toBe("run-1");
    await expect.poll(() => text(sentinel, "atom-state")).toBe("run-1");

    invalidateAtomKeys(["some-other-family"]);

    // The sentinel IS in the invalidated family: once its refresh has landed, an
    // errant refresh of the scoped atom would have landed too — no wall-clock
    // margin needed for the negative assertion.
    await expect.poll(() => text(sentinel, "atom-state")).toBe("run-2");
    expect(text(scoped, "atom-state")).toBe("run-1");
  });

  it("invalidates through an explicitly provided registry", async () => {
    const registry = makeAtomRegistry();
    const target = mounter.mount(AtomProbe, {
      select: fixed(countingAtom(["explicit"]) as never),
      registry,
    });
    await expect.poll(() => text(target, "atom-state")).toBe("run-1");

    invalidateAtomKeys(["explicit"], registry);

    await expect.poll(() => text(target, "atom-state")).toBe("run-2");
    registry.dispose();
  });

  it("makes a provided registry the default for invalidateAtomKeys", async () => {
    const registry = makeAtomRegistry({ defaultIdleTTL: 1_000 });
    const target = mounter.mount(WritableAtomProbe, {
      atom: Atom.make(0),
      derived: countingAtom(["provided"]).pipe(
        Atom.map((result) => (result._tag === "Success" ? result.value : "loading")),
      ),
      registry,
    });
    await expect.poll(() => text(target, "label")).toBe("run-1");

    invalidateAtomKeys(["provided"]);

    await expect.poll(() => text(target, "label")).toBe("run-2");
    expect(getAtomRegistry()).toBe(registry);
  });

  it("follows the thunk to a new atom when the key changes", async () => {
    const atoms: Record<string, Atom.Atom<never>> = {
      first: Atom.make(Effect.succeed("first")) as never,
      second: Atom.make(Effect.succeed("second")) as never,
    };
    let key = $state("first");
    const target = mounter.mount(AtomProbe, {
      select: (k: string) => atoms[k]!,
      get key() {
        return key;
      },
    });
    await expect.poll(() => text(target, "atom-state")).toBe("first");

    key = "second";
    await tick();

    await expect.poll(() => text(target, "atom-state")).toBe("second");
  });
});

describe("useAtom", () => {
  it("reads and writes a writable atom, and re-renders its dependants", async () => {
    const registry = makeAtomRegistry();
    const count = Atom.make(1);
    const label = Atom.make((get) => `count is ${get(count)}`);
    const target = mounter.mount(WritableAtomProbe, { atom: count, derived: label, registry });
    await flush();
    expect(text(target, "increment")).toBe("1");
    expect(text(target, "label")).toBe("count is 1");

    target.querySelector<HTMLButtonElement>('[data-testid="increment"]')!.click();

    await expect.poll(() => text(target, "increment")).toBe("2");
    expect(text(target, "label")).toBe("count is 2");
    expect(registry.get(count)).toBe(2);
    registry.dispose();
  });

  it("reflects writes made through the registry from outside the component", async () => {
    const registry = makeAtomRegistry();
    const count = Atom.make(10);
    const target = mounter.mount(WritableAtomProbe, {
      atom: count,
      derived: Atom.make("static"),
      registry,
    });
    await flush();

    registry.set(count, 42);

    await expect.poll(() => text(target, "increment")).toBe("42");
    registry.dispose();
  });
});
