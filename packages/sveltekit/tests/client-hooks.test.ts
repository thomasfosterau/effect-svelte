import { describe, expect, it } from "vite-plus/test";
import { Effect } from "effect";
import { handleError, init } from "../src/client-hooks.js";

const navigationEvent = (pathname = "/") =>
  ({
    url: new URL(`http://localhost${pathname}`),
    params: {},
    route: { id: null },
  }) as any;

describe("client handleError", () => {
  it("runs an effect and returns the App.Error shape", async () => {
    const hook = handleError(({ error, event }) =>
      Effect.succeed({ message: `${(error as Error).message} @ ${event.url.pathname}` }),
    );
    const result = await hook({
      error: new Error("boom"),
      event: navigationEvent("/items"),
      status: 500,
      message: "Internal Error",
    });
    expect(result).toEqual({ message: "boom @ /items" });
  });

  it("allows returning nothing (void)", async () => {
    const hook = handleError(() => Effect.void);
    const result = await hook({
      error: new Error("boom"),
      event: navigationEvent(),
      status: 500,
      message: "Internal Error",
    });
    expect(result).toBeUndefined();
  });

  it("throws when the effect fails", async () => {
    const hook = handleError(() => Effect.fail("nope"));
    await expect(
      hook({
        error: new Error("boom"),
        event: navigationEvent(),
        status: 500,
        message: "Internal Error",
      }),
    ).rejects.toThrow();
  });
});

describe("client init", () => {
  it("runs the effect once", async () => {
    let started = 0;
    const hook = init(
      Effect.sync(() => {
        started++;
      }),
    );
    await hook();
    expect(started).toBe(1);
  });

  it("throws when the init effect fails", async () => {
    const hook = init(Effect.fail("startup failed"));
    await expect(hook()).rejects.toThrow();
  });
});
