import { assert, describe, expect, it, onTestFinished } from "vite-plus/test";
import type { SubmitFunction } from "$app/forms";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import {
  makeSubmitFunction,
  type ResultOptions,
  type SubmitInput,
} from "../src/internal/enhance.js";

// SAFETY: no handler under test reads `formElement`, and the Node test project
// has no DOM to build a real `<form>` from.
const formElement = {} as HTMLFormElement;

/** A minimal SubmitFunction input; only what a handler touches is populated. */
const submitInput = (over: Partial<SubmitInput> = {}): SubmitInput => ({
  action: new URL("http://localhost/?/create"),
  formData: new FormData(),
  formElement,
  controller: new AbortController(),
  submitter: null,
  cancel: () => {},
  ...over,
});

const resultOptions = (): ResultOptions => ({
  result: { type: "success", status: 200, location: "/" },
  formData: new FormData(),
  formElement,
  action: new URL("http://localhost/?/create"),
  update: () => Promise.resolve(),
});

/** Asserts the submit function returned a result callback, then runs it. */
const runResult = async (callback: Awaited<ReturnType<SubmitFunction>>): Promise<void> => {
  assert(Predicate.isFunction(callback), "expected a result callback");
  await callback(resultOptions());
};

/** A handlers object whose handlers a test adds, replaces and removes. */
interface MutableHandlers<A> {
  onSubmit?: () => Effect.Effect<A>;
  onResult?: () => Effect.Effect<A>;
}

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

    await runResult(await submit(submitInput()));
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

    onTestFinished(() => runtime.dispose());
    await runResult(await submit(submitInput()));
    expect(seen).toEqual(["submit: hello", "result: hello"]);
  });

  it("reads onSubmit and onResult on each submission", async () => {
    const calls: Array<string> = [];
    const record = (call: string) => () => Effect.sync(() => calls.push(call));
    const handlers: MutableHandlers<number> = {};
    const submit = makeSubmitFunction(handlers);

    // No handlers yet: SvelteKit's default result behaviour applies.
    expect(await submit(submitInput())).toBeUndefined();

    // Handlers added (or replaced) after `enhance()` run on the next submission.
    handlers.onSubmit = record("submit");
    handlers.onResult = record("result");
    await runResult(await submit(submitInput()));
    expect(calls).toEqual(["submit", "result"]);

    handlers.onSubmit = record("submit again");
    delete handlers.onResult;
    expect(await submit(submitInput())).toBeUndefined();
    expect(calls).toEqual(["submit", "result", "submit again"]);
  });

  it("reads onResult after onSubmit has run", async () => {
    const calls: Array<string> = [];
    const handlers: MutableHandlers<void> = {
      onSubmit: () =>
        Effect.sync(() => {
          calls.push("submit");
          // Set by onSubmit itself: the handler read before it ran is gone.
          handlers.onResult = () => Effect.sync(() => calls.push("result set by onSubmit"));
        }),
      onResult: () => Effect.sync(() => calls.push("stale result")),
    };
    const submit = makeSubmitFunction(handlers);

    await runResult(await submit(submitInput()));
    expect(calls).toEqual(["submit", "result set by onSubmit"]);
  });

  it("calls each handler as a method of the handlers object", async () => {
    class Invalid extends Schema.TaggedError<Invalid>()("Invalid", {}) {}
    const receivers: Array<[string, unknown]> = [];
    const handlers = {
      onSubmit() {
        receivers.push(["onSubmit", this]);
        return Effect.void;
      },
      onResult() {
        receivers.push(["onResult", this]);
        return Effect.fail(new Invalid());
      },
      onError() {
        receivers.push(["onError", this]);
        return Effect.void;
      },
    };
    const submit = makeSubmitFunction(handlers);

    await runResult(await submit(submitInput()));
    expect(receivers).toEqual([
      ["onSubmit", handlers],
      ["onResult", handlers],
      ["onError", handlers],
    ]);
    expect(receivers.every(([, receiver]) => receiver === handlers)).toBe(true);
  });
});
