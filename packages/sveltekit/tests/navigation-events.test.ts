import { describe, expect, it } from "vite-plus/test";
import { Effect, Stream } from "effect";
import { onNavigateWith, registeredStream } from "../src/internal/navigation-events.js";

describe("registeredStream", () => {
  it("yields events offered through the registered callback", async () => {
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

    const values = await Effect.runPromise(Stream.runCollect(Stream.take(stream, 3)));
    expect(values).toEqual([1, 2, 3]);
  });

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
      Effect.runPromise,
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
      Effect.runPromise,
    );

    const cleanup = await captured("/a");
    expect(typeof cleanup).toBe("function");
    (cleanup as () => void)();
    expect(cleanedUp).toBe(true);
  });
});
