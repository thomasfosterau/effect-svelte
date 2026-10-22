/**
 * `useDebouncedSearch`, ported from the shared components library's
 * `combobox-async-search` suite. The regression it guards: query changes emitted
 * on a LATER tick than mount must reach the search (an earlier bridge through
 * `SignalEmitter` dropped them, until #126 fixed its stream cleanup), and a
 * superseded in-flight search must be interrupted, not merely ignored.
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import DebouncedSearch from "./DebouncedSearch.svelte";
import { flush, makeMounter, text } from "./helpers.js";

const OPTIONS = [
  { id: "1", label: "Parent Issue alpha" },
  { id: "2", label: "Parent Issue beta" },
];

const filter = (query: string) =>
  OPTIONS.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));

/** An interruptible search (a 5 ms sleep before the filtered result). */
const asyncSearch = (query: string) =>
  Effect.sleep(Duration.millis(5)).pipe(Effect.map(() => filter(query)));

const mounter = makeMounter();
afterEach(mounter.cleanup);

const results = (target: HTMLElement): Array<string> =>
  [...target.querySelectorAll('[data-testid="results"] li')].map((li) => li.textContent!.trim());

const setup = (
  onSearch: (q: string) => Effect.Effect<ReadonlyArray<{ id: string; label: string }>, unknown>,
  debounceMs = 50,
) => {
  const runtime = ManagedRuntime.make(Layer.empty);
  let emit: (q: string) => void = () => {};
  const target = mounter.mount(DebouncedSearch, {
    runtime,
    debounceMs,
    onSearch,
    expose: (c: { emit: (q: string) => void }) => {
      emit = c.emit;
    },
  });
  return { target, runtime, emit: (q: string) => emit(q) };
};

describe("useDebouncedSearch", () => {
  it("renders results for a query emitted AFTER the subscription activated", async () => {
    const { target, emit, runtime } = setup(asyncSearch);
    // Let mount settle so the useStream subscription fiber has forked AND
    // suspended — the condition under which the old bridge stopped accepting values.
    await flush();
    await flush();

    emit("Issue");

    await expect
      .poll(() => results(target), { timeout: 3000 })
      .toEqual(["Parent Issue alpha", "Parent Issue beta"]);
    expect(text(target, "pending")).toBe("idle");
    await runtime.dispose();
  });

  it("keeps the previous results while the next search is pending, and resets on an empty query", async () => {
    // The "beta" search is held on a gate the test opens, so the pending state
    // lasts exactly until the assertions have run. A fixed sleep here raced
    // `expect.poll`'s 50 ms sampling interval: the pending window (debounce plus
    // sleep) ended right as the second sample fired, so a loaded runner sampled
    // only "idle".
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { target, emit, runtime } = setup(
      (q) =>
        (q === "beta" ? Effect.promise(() => gate) : Effect.sleep(Duration.millis(5))).pipe(
          Effect.map(() => filter(q)),
        ),
      10,
    );
    await flush();

    emit("alpha");
    await expect.poll(() => results(target)).toEqual(["Parent Issue alpha"]);

    emit("beta");
    await expect.poll(() => text(target, "pending")).toBe("pending");
    expect(results(target)).toEqual(["Parent Issue alpha"]);
    release();
    await expect.poll(() => results(target)).toEqual(["Parent Issue beta"]);

    emit("   ");
    await expect.poll(() => results(target)).toEqual([]);
    expect(text(target, "pending")).toBe("idle");
    await runtime.dispose();
  });

  it("surfaces a failed search as an error message and clears the results", async () => {
    const { target, emit, runtime } = setup((q) =>
      q === "boom" ? Effect.fail(new Error("search exploded")) : asyncSearch(q),
    );
    await flush();

    emit("alpha");
    await expect.poll(() => results(target)).toEqual(["Parent Issue alpha"]);
    emit("boom");

    await expect.poll(() => text(target, "error")).toBe("search exploded");
    expect(results(target)).toEqual([]);
    await runtime.dispose();
  });

  it("interrupts the previous search Effect when a newer query supersedes it mid-flight", async () => {
    // Driven on fake timers: Effect's Clock schedules `Effect.sleep` and
    // `Stream.debounce` via the global `setTimeout`, which `vi.useFakeTimers()`
    // intercepts — every step happens at an exact virtual instant.
    vi.useFakeTimers();
    try {
      const events: Array<string> = [];
      const trackedSearch = (query: string) =>
        Effect.sleep(Duration.millis(500)).pipe(
          Effect.map(() => filter(query)),
          Effect.tap(() => Effect.sync(() => events.push(`done:${query}`))),
          Effect.onInterrupt(() => Effect.sync(() => events.push(`interrupted:${query}`))),
        );
      const { target, emit, runtime } = setup(trackedSearch, 20);

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);

      // First query passes the 20 ms debounce and starts its 500 ms search.
      emit("alpha");
      await vi.advanceTimersByTimeAsync(21);
      expect(events).toEqual([]);

      // Second query supersedes it while alpha's search is still sleeping.
      emit("beta");
      await vi.advanceTimersByTimeAsync(21);
      expect(events).toEqual(["interrupted:alpha"]);

      // Drain the remaining timers (beta's 500 ms sleep) so its result lands.
      await vi.runAllTimersAsync();

      expect(events).toEqual(["interrupted:alpha", "done:beta"]);
      expect(results(target)).toEqual(["Parent Issue beta"]);
      await runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
