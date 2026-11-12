import { it } from "@effect/vitest";
import { assert, describe, expect } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as P from "effect/Predicate";
import * as Stream from "effect/Stream";
import { onNavigateWith, registeredStream } from "../src/internal/navigation-events.js";
import { runPromise } from "../src/internal/run.js";

describe("registeredStream", () => {
  it.effect("yields events offered through the registered callback", () =>
    Effect.gen(function* () {
      // Stand in for $app/navigation's beforeNavigate/afterNavigate registrar:
      // capture the callback so the test can drive it directly.
      let emit!: (value: number) => void;
      const stream = registeredStream<number>((callback) => {
        emit = callback;
      });

      // Offer a fixed number of events, then take exactly that many so the
      // queue-backed stream terminates deterministically.
      emit(1);
      emit(2);
      emit(3);

      const values = yield* Stream.runCollect(Stream.take(stream, 3));
      expect(values).toEqual([1, 2, 3]);
    }),
  );

  it("registers the callback eagerly (synchronously)", () => {
    let registered = false;
    registeredStream<number>(() => {
      registered = true;
    });
    expect(registered).toBe(true);
  });
});

describe("onNavigateWith", () => {
  it("runs the Effect for each navigation", async () => {
    let captured!: (value: string) => Promise<(() => void) | void> | (() => void) | void;
    const seen: Array<string> = [];

    onNavigateWith<string>(
      (callback) => {
        captured = callback;
      },
      (navigation) =>
        Effect.sync(() => {
          seen.push(navigation);
        }),
      runPromise,
    );

    await captured("/a");
    await captured("/b");
    expect(seen).toEqual(["/a", "/b"]);
  });

  it("forwards the Effect's cleanup function back to the registrar", async () => {
    let captured!: (value: string) => Promise<(() => void) | void> | (() => void) | void;
    let cleanedUp = false;

    onNavigateWith<string>(
      (callback) => {
        captured = callback;
      },
      () => Effect.succeed(() => (cleanedUp = true)),
      runPromise,
    );

    const cleanup = await captured("/a");
    assert(P.isFunction(cleanup), "expected a cleanup function");
    cleanup();
    expect(cleanedUp).toBe(true);
  });
});
