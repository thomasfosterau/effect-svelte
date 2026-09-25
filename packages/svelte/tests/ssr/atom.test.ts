import { describe, expect, it } from "vite-plus/test";
import { render } from "svelte/server";
import AtomSsr from "./AtomSsr.svelte";

describe("atom hooks during SSR", () => {
  it("renders useAtomResult as its loading state without evaluating the atom", async () => {
    let evaluations = 0;
    const out = await render(AtomSsr, { props: { onEvaluate: () => void evaluations++ } });

    expect(out.body).toContain("loading");
    expect(evaluations).toBe(0);
  });

  it("evaluates a plain useAtom value once", async () => {
    const out = await render(AtomSsr, { props: { onEvaluate: () => {} } });

    expect(out.body).toContain("plain-value");
  });
});
