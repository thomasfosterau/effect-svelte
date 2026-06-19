import { describe, expect, it } from "vite-plus/test";
import { Effect, Stream } from "effect";
import { liveQueryStream } from "../src/remote-call.js";

describe("liveQueryStream", () => {
  it("consumes a RemoteLiveQuery (AsyncIterable) as a Stream", async () => {
    const live = {
      async *[Symbol.asyncIterator]() {
        yield 1;
        yield 2;
        yield 3;
      },
    } as never;

    const values = await Effect.runPromise(Stream.runCollect(liveQueryStream<number>(live)));
    expect(values).toEqual([1, 2, 3]);
  });

  it("surfaces iteration errors on the Stream's error channel", async () => {
    const boom = new Error("boom");
    const live = {
      // eslint-disable-next-line require-yield
      async *[Symbol.asyncIterator]() {
        throw boom;
      },
    } as never;

    const exit = await Effect.runPromise(Effect.exit(Stream.runCollect(liveQueryStream(live))));
    expect(exit._tag).toBe("Failure");
  });
});
