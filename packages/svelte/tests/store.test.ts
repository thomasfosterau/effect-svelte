import { describe, expect, it } from "vite-plus/test";
import { Effect, Stream } from "effect";
import { writable } from "svelte/store";
import { streamFromStore } from "../src/store.js";

describe("streamFromStore", () => {
  it("emits the store's current value on subscribe", async () => {
    const store = writable(42);

    // The readable store contract emits the current value synchronously on
    // subscribe, so taking one value is deterministic.
    const values = await Effect.runPromise(
      Stream.runCollect(Stream.take(streamFromStore(store), 1)),
    );
    expect(values).toEqual([42]);
  });

  it("forwards every value pushed by the store contract", async () => {
    // A custom readable that pushes several values synchronously on subscribe.
    const store = {
      subscribe(run: (value: number) => void) {
        run(1);
        run(2);
        run(3);
        return () => {};
      },
    };

    const values = await Effect.runPromise(
      Stream.runCollect(Stream.take(streamFromStore(store), 3)),
    );
    expect(values).toEqual([1, 2, 3]);
  });
});
