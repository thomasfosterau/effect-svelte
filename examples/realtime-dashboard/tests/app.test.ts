/**
 * Runtime smoke test (#136): mounts the whole dashboard in happy-dom and fails
 * on an uncaught error, a Svelte runtime error, or a lookup that keeps
 * re-running itself.
 *
 * The dashboard is timer-driven (1 s quote streams, a 400 ms simulated lookup,
 * a 300 ms search debounce), so the test runs on Vitest's fake timers: Effect's
 * clock and scheduler use `setTimeout` / `setImmediate`, and advancing virtual
 * time makes every count below exact rather than a race against the wall clock.
 */
import { Effect } from "effect";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import App from "../src/App.svelte";
import { MarketData } from "../src/lib/market";
import { appRuntime } from "../src/lib/runtime";
import { captureErrors } from "./smoke";

let errors: ReturnType<typeof captureErrors>;
let target: HTMLElement;
let app: Record<string, unknown> | undefined;

beforeEach(() => {
  errors = captureErrors();
  target = document.body.appendChild(document.createElement("div"));
});

afterEach(async () => {
  if (app) await unmount(app);
  app = undefined;
  vi.useRealTimers();
  target.remove();
  errors.dispose();
  vi.restoreAllMocks();
});

/** The text of the panel whose heading starts with `heading`. */
const panel = (heading: string): string => {
  const section = [...target.querySelectorAll("section")].find((element) =>
    element.querySelector("h2")?.textContent?.startsWith(heading),
  );
  return section?.textContent?.replace(/\s+/g, " ").trim() ?? "";
};

describe("realtime dashboard", () => {
  it("streams prices, looks a quote up once, and answers a symbol search", async () => {
    // The app's runtime is a ManagedRuntime, so this is the same MarketData
    // instance the components use: spy on it to count lookups. Fetched before
    // faking timers, because building the layer schedules work.
    const market = await appRuntime.runPromise(
      Effect.gen(function* () {
        return yield* MarketData;
      }),
    );
    const lookup = vi.spyOn(market, "lookup");

    vi.useFakeTimers();
    app = mount(App, { target });
    flushSync();

    // Past the first quote tick (1 s) and the spot-quote lookup (400 ms).
    await vi.advanceTimersByTimeAsync(1_500);
    flushSync();

    const tickers = [...target.querySelectorAll(".ticker")];
    expect(tickers.map((ticker) => ticker.querySelector(".symbol")?.textContent)).toEqual([
      "BTC",
      "ETH",
      "SOL",
      "ADA",
    ]);
    for (const ticker of tickers) expect(ticker.querySelector(".price")?.textContent).toMatch(/\$/);

    expect(panel("Spot quote")).toMatch(/\$\d/);
    expect(lookup.mock.calls).toEqual([["BTC"]]);

    // The spot quote (`useDerived`) does not re-fetch on its own: a few more
    // seconds of quote ticks bring no further lookups.
    await vi.advanceTimersByTimeAsync(5_000);
    flushSync();
    expect(lookup.mock.calls).toEqual([["BTC"]]);

    // The symbol search (`SignalEmitter` → `useStream`): typing a symbol is
    // debounced (300 ms), normalised, looked up (400 ms), and rendered.
    const search = target.querySelector<HTMLInputElement>("#search")!;
    search.value = "eth";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    await vi.advanceTimersByTimeAsync(1_000);
    flushSync();

    expect(panel("Symbol lookup")).toMatch(/ETH: \$\d/);
    expect(lookup.mock.calls).toEqual([["BTC"], ["ETH"]]);

    expect(errors.errors).toEqual([]);
  });
});
