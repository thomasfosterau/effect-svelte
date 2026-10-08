/**
 * `SignalEmitter` driven from a component, as its TSDoc example does (#134):
 * the `$effect`'s `emit`s must reach a `useStream` consumer, including those
 * made before the consumer's run has connected (connecting is asynchronous, and
 * `useStream` only starts its run once the template reads it).
 */
import { Layer, ManagedRuntime } from "effect";
import { flushSync } from "svelte";
import { afterEach, describe, expect, it } from "vite-plus/test";
import SignalEmitterProbe from "./SignalEmitterProbe.svelte";
import { makeMounter, text } from "./helpers.js";

const mounter = makeMounter();
afterEach(mounter.cleanup);

interface Controls {
  increment: () => void;
  show: () => void;
}

const setup = (deferred: boolean) => {
  const runtime = ManagedRuntime.make(Layer.empty);
  let controls: Controls = { increment: () => {}, show: () => {} };
  const target = mounter.mount(SignalEmitterProbe, {
    runtime,
    deferred,
    expose: (exposed: Controls) => {
      controls = exposed;
    },
  });
  return { target, runtime, controls: () => controls };
};

describe("SignalEmitter in a component", () => {
  it("delivers the initial emit from a $effect to a useStream consumer, then each change", async () => {
    const { target, runtime, controls } = setup(false);

    await expect.poll(() => text(target, "values"), { timeout: 2000 }).toBe("0");

    controls().increment();
    flushSync();
    await expect.poll(() => text(target, "values"), { timeout: 2000 }).toBe("0,2");

    await runtime.dispose();
  });

  it("delivers the latest value emitted before the consumer first renders once it does", async () => {
    const { target, runtime, controls } = setup(true);
    // The `$effect` emits `count` 0, then 1, while nothing reads the stream:
    // the default buffer keeps only the latest, 1.
    flushSync();
    controls().increment();
    flushSync();
    expect(text(target, "values")).toBeNull();

    controls().show();
    flushSync();
    await expect.poll(() => text(target, "values"), { timeout: 2000 }).toBe("2");

    controls().increment();
    flushSync();
    await expect.poll(() => text(target, "values"), { timeout: 2000 }).toBe("2,4");

    await runtime.dispose();
  });
});
