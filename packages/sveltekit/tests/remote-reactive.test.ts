import { describe, expect, it } from "vite-plus/test";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useRemoteQuery } from "../src/remote-reactive.js";

// Minimal stand-ins for SvelteKit's reactive RemoteResource shape.
const resource = <T>(fields: { loading: boolean; error?: unknown; ready: boolean; current?: T }) =>
  fields as never;

describe("useRemoteQuery", () => {
  it("maps a ready resource to a Success", () => {
    const r = useRemoteQuery<number>(resource({ loading: false, ready: true, current: 42 }));
    expect(AsyncResult.isSuccess(r.current)).toBe(true);
    expect(AsyncResult.getOrThrow(r.current)).toBe(42);
    expect(r.current.waiting).toBe(false);
  });

  it("maps a not-yet-ready resource to a waiting Initial", () => {
    const r = useRemoteQuery<number>(resource({ loading: true, ready: false }));
    expect(AsyncResult.isInitial(r.current)).toBe(true);
    expect(r.current.waiting).toBe(true);
  });

  it("surfaces an error as a Failure, carrying the loading flag as waiting", () => {
    const r = useRemoteQuery<number>(
      resource({ loading: true, ready: false, error: new Error("boom") }),
    );
    expect(AsyncResult.isFailure(r.current)).toBe(true);
    expect(r.current.waiting).toBe(true);
  });

  it("keeps a refreshing success as a waiting Success (stale-while-revalidate)", () => {
    const r = useRemoteQuery<number>(resource({ loading: true, ready: true, current: 7 }));
    expect(AsyncResult.isSuccess(r.current)).toBe(true);
    expect(AsyncResult.getOrThrow(r.current)).toBe(7);
    expect(r.current.waiting).toBe(true);
  });
});
