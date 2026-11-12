import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { type FormErrorMapper, makeRunHelpers } from "../src/internal/remote-run.js";
import { ForeignError } from "./fixtures/foreign-error.js";

/** The `issue` helper a remote form handler receives. */
type FormIssue = Parameters<FormErrorMapper>[1]["issue"];

/** A resolver that runs effects that require no services, with no teardown. */
const bareResolver = () => ({ runExit: Effect.runPromiseExit });

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
      throw new ForeignError("should not translate");
    });
    expect(await run(Effect.succeed(42))).toBe(42);
  });

  it("run throws via the translator on failure", async () => {
    const { run } = makeRunHelpers(bareResolver, () => {
      throw new ForeignError("translated");
    });
    await expect(run(Effect.fail("boom"))).rejects.toThrow("translated");
  });

  it("runForm routes a failure through formError with issue/data", async () => {
    const issues: Array<[string, string]> = [];
    const issue: FormIssue = {
      field: (name: string, message: string) => issues.push([name, message]),
    };

    const { runForm } = makeRunHelpers(
      bareResolver,
      () => {
        throw new ForeignError("translate should not be used");
      },
      (error, ctx) => {
        if (error instanceof ValidationFailure) {
          ctx.issue["field"](error.field, error.message);
        }
        throw new ForeignError("invalid()");
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
      throw new ForeignError("translated");
    });
    await expect(runForm(Effect.fail("boom"), { issue: {}, data: {} })).rejects.toThrow(
      "translated",
    );
  });

  it("runs teardown after settling", async () => {
    const order: string[] = [];
    const resolver = () => ({
      runExit: Effect.runPromiseExit,
      dispose: () => order.push("dispose"),
    });
    const { run } = makeRunHelpers(resolver, () => {
      throw new ForeignError("x");
    });
    await run(Effect.sync(() => order.push("run")));
    expect(order).toEqual(["run", "dispose"]);
  });
});
