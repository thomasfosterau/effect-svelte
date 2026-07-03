import { describe, expect, it } from "vite-plus/test";
import { render } from "svelte/server";
import { SvelteRuntime } from "../../src/runtime.js";
import Seed from "./Seed.svelte";

describe("useLiveStream SSR seed", () => {
  it("renders the seed synchronously through an already-resolved promise", async () => {
    // `render` returns a thenable under experimental async; awaiting settles any
    // resolved awaits in the tree.
    const out = await render(Seed, {
      props: { initial: "from-server", runtime: SvelteRuntime.defaultRuntime },
    });

    // The seed value is present in the SSR HTML — no client `$effect`, no
    // hydration mismatch, no empty first paint.
    expect(out.body).toContain("value:from-server");
  });
});
