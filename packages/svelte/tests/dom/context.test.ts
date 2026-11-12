/**
 * The shared runtime context: `provideRuntime` in an ancestor (here, the same
 * component, before the hook), then a hook with no `runtime` option reads it.
 */
import * as Context from "effect/Context";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Result from "effect/Result";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { flushSync } from "svelte";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { getRuntime, provideRuntime } from "../../src/context.svelte.js";
import { useEffect } from "../../src/effect.svelte.js";
import type { RuntimeLike } from "../../src/internal/run.js";
import ResultProbe from "./ResultProbe.svelte";
import { makeMounter, text } from "./helpers.js";
import { Multiplier } from "./service.js";

const mounter = makeMounter();
afterEach(mounter.cleanup);

interface ProbeProps<A, E> {
  readonly use: () => { readonly current: AsyncResult.AsyncResult<A, E> };
}

const mountProbe = <A, E>(props: ProbeProps<A, E>) => {
  const target = mounter.mount<ProbeProps<A, E>>(ResultProbe, props);
  flushSync();
  return target;
};

describe("the shared runtime context", () => {
  it("runs a hook with no `runtime` option on the provided runtime, services included", () => {
    const target = mountProbe({
      use: () => {
        provideRuntime(Context.make(Multiplier, { factor: 3 }));
        return useEffect(
          Multiplier.useSync((multiplier) => multiplier.factor * 2),
          { immediate: true },
        );
      },
    });

    expect(text(target, "tag")).toEqual(Option.some("Success"));
    expect(text(target, "value")).toEqual(Option.some("6"));
  });

  it("getRuntime returns the runtime an ancestor provided", () => {
    const provided = Context.make(Multiplier, { factor: 3 });
    let found: Option.Option<RuntimeLike<never>> = Option.none();
    mountProbe({
      use: () => {
        provideRuntime(provided);
        found = Option.some(getRuntime());
        return { current: AsyncResult.initial() };
      },
    });

    expect(Option.exists(found, (runtime) => runtime === provided)).toBe(true);
  });

  it("getRuntime throws RuntimeNotFoundError when nothing was provided", () => {
    let outcome: Option.Option<Result.Result<RuntimeLike<never>, unknown>> = Option.none();
    mountProbe({
      use: () => {
        outcome = Option.some(Result.try(getRuntime));
        return { current: AsyncResult.initial() };
      },
    });

    const failure = Option.flatMap(outcome, Result.getFailure);
    expect(Option.exists(failure, P.isTagged("RuntimeNotFoundError"))).toBe(true);
    expect(
      Option.exists(
        failure,
        (error) =>
          P.hasProperty(error, "message") &&
          error.message ===
            "effect-svelte: No Effect runtime found in context. " +
              "Make sure you have called provideRuntime() in a parent component.",
      ),
    ).toBe(true);
  });
});
