import { describe, expect, it } from "vite-plus/test";
import type { SubmitFunction } from "$app/forms";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { makeSubmitFunction } from "../src/internal/enhance.js";

/** A minimal SubmitFunction input; only what a handler touches is populated. */
const submitInput = (
  over: Partial<Parameters<SubmitFunction>[0]> = {},
): Parameters<SubmitFunction>[0] =>
  ({
    action: new URL("http://localhost/?/create"),
    formData: new FormData(),
    formElement: {} as HTMLFormElement,
    controller: new AbortController(),
    submitter: null,
    cancel: () => {},
    ...over,
  }) as Parameters<SubmitFunction>[0];

const resultOptions = (): never =>
  ({
    result: { type: "success", status: 200 },
    formData: new FormData(),
    formElement: {} as HTMLFormElement,
    action: new URL("http://localhost/?/create"),
    update: () => Promise.resolve(),
  }) as never;

describe("makeSubmitFunction", () => {
  it("runs onSubmit before the request", async () => {
    const calls: Array<string> = [];
    const submit = makeSubmitFunction({
      onSubmit: () => Effect.sync(() => calls.push("submit")),
    });

    await submit(submitInput());
    expect(calls).toEqual(["submit"]);
  });

  it("returns undefined (default behaviour) when no onResult is given", async () => {
    const submit = makeSubmitFunction({ onSubmit: () => Effect.void });
    const result = await submit(submitInput());
    expect(result).toBeUndefined();
  });

  it("returns a result callback that runs onResult", async () => {
    const calls: Array<string> = [];
    const submit = makeSubmitFunction({
      onSubmit: () => Effect.sync(() => calls.push("submit")),
      onResult: () => Effect.sync(() => calls.push("result")),
    });

    const callback = await submit(submitInput());
    expect(typeof callback).toBe("function");
    await (callback as (o: unknown) => Promise<void>)(resultOptions());
    expect(calls).toEqual(["submit", "result"]);
  });

  it("lets onSubmit cancel the submission", async () => {
    let cancelled = false;
    const submit = makeSubmitFunction({
      onSubmit: (input) => Effect.sync(() => input.cancel()),
    });

    await submit(submitInput({ cancel: () => (cancelled = true) }));
    expect(cancelled).toBe(true);
  });

  it("runs handler effects against the provided runtime", async () => {
    class Greeter extends Context.Service<Greeter, { readonly hi: string }>()("Greeter") {}
    const runtime = Context.make(Greeter, { hi: "hello" });

    let seen = "";
    const submit = makeSubmitFunction(
      {
        onSubmit: () =>
          Effect.gen(function* () {
            const greeter = yield* Greeter;
            seen = greeter.hi;
          }),
      },
      { runtime },
    );

    await submit(submitInput());
    expect(seen).toBe("hello");
  });

  it("runs onSubmit and onResult against a provided ManagedRuntime", async () => {
    class Greeter extends Context.Service<Greeter, { readonly hi: string }>()("Greeter") {}
    const runtime = ManagedRuntime.make(Layer.succeed(Greeter, { hi: "hello" }));

    const seen: Array<string> = [];
    const greet = (phase: string) => () =>
      Effect.gen(function* () {
        const greeter = yield* Greeter;
        seen.push(`${phase}: ${greeter.hi}`);
      });
    const submit = makeSubmitFunction(
      { onSubmit: greet("submit"), onResult: greet("result") },
      { runtime },
    );

    try {
      const callback = await submit(submitInput());
      await (callback as (o: unknown) => Promise<void>)(resultOptions());
      expect(seen).toEqual(["submit: hello", "result: hello"]);
    } finally {
      await runtime.dispose();
    }
  });
});
