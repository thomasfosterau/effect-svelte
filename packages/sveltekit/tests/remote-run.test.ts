import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { makeRunHelpers } from "../src/internal/remote-run.js";

/** A resolver that runs effects with no services and no teardown. */
const bareResolver = () => ({
  runExit: <A>(effect: Effect.Effect<A, unknown, any>) =>
    Effect.runPromiseExit(effect as Effect.Effect<A, unknown, never>),
});

class ValidationFailure {
  readonly _tag = "ValidationFailure";
  constructor(
    readonly field: string,
    readonly message: string,
  ) {}
}

describe("makeRunHelpers", () => {
  it("run returns the success value", async () => {
    const { run } = makeRunHelpers(bareResolver, () => {
      throw new Error("should not translate");
    });
    expect(await run(Effect.succeed(42))).toBe(42);
  });

  it("run throws via the translator on failure", async () => {
    const { run } = makeRunHelpers(bareResolver, () => {
      throw new Error("translated");
    });
    await expect(run(Effect.fail("boom"))).rejects.toThrow("translated");
  });

  it("runForm routes a failure through formError with issue/data", async () => {
    const issues: Array<[string, string]> = [];
    const issue = {
      field: (name: string, message: string) => issues.push([name, message]),
    } as any;

    const { runForm } = makeRunHelpers(
      bareResolver,
      () => {
        throw new Error("translate should not be used");
      },
      (error, ctx) => {
        if (error instanceof ValidationFailure) {
          (ctx.issue as any).field(error.field, error.message);
        }
        throw new Error("invalid()");
      },
    );

    await expect(
      runForm(Effect.fail(new ValidationFailure("email", "required")), {
        issue,
        data: { email: "" },
      }),
    ).rejects.toThrow("invalid()");
    expect(issues).toEqual([["email", "required"]]);
  });

  it("runForm falls back to the translator when no formError is given", async () => {
    const { runForm } = makeRunHelpers(bareResolver, () => {
      throw new Error("translated");
    });
    await expect(runForm(Effect.fail("boom"), { issue: {} as any, data: {} })).rejects.toThrow(
      "translated",
    );
  });

  it("runs teardown after settling", async () => {
    const order: string[] = [];
    const resolver = () => ({
      runExit: <A>(effect: Effect.Effect<A, unknown, any>) =>
        Effect.runPromiseExit(effect as Effect.Effect<A, unknown, never>),
      dispose: () => order.push("dispose"),
    });
    const { run } = makeRunHelpers(resolver, () => {
      throw new Error("x");
    });
    await run(Effect.sync(() => order.push("run")));
    expect(order).toEqual(["run", "dispose"]);
  });
});
