import type { RemoteResource } from "$app/server";
import { assert, describe, expect, it } from "vite-plus/test";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useRemoteQuery } from "../src/remote-reactive.js";

// Minimal stand-ins for SvelteKit's reactive RemoteResource shape.

/** A resource whose value has arrived (`loading` while it refreshes). */
const readyResource = <T>(current: T, loading: boolean): RemoteResource<T> =>
  Object.assign(Promise.resolve(current), {
    error: undefined,
    loading,
    current,
    ready: true as const,
  });

/** A resource still waiting for its first value, optionally with an error. */
const pendingResource = <T>(loading: boolean, error?: App.Error): RemoteResource<T> =>
  Object.assign(new Promise<T>(() => {}), {
    error,
    loading,
    current: undefined,
    ready: false as const,
  });

describe("useRemoteQuery", () => {
  it("maps a ready resource to a Success", () => {
    const r = useRemoteQuery<number>(readyResource(42, false));
    const current = r.current;
    assert(AsyncResult.isSuccess(current), "expected a Success");
    expect(current.value).toBe(42);
    expect(current.waiting).toBe(false);
  });

  it("maps a not-yet-ready resource to a waiting Initial", () => {
    const r = useRemoteQuery<number>(pendingResource(true));
    expect(AsyncResult.isInitial(r.current)).toBe(true);
    expect(r.current.waiting).toBe(true);
  });

  it("surfaces an error as a Failure, carrying the loading flag as waiting", () => {
    const r = useRemoteQuery<number>(pendingResource(true, { status: 500, message: "boom" }));
    expect(AsyncResult.isFailure(r.current)).toBe(true);
    expect(r.current.waiting).toBe(true);
  });

  it("keeps a refreshing success as a waiting Success (stale-while-revalidate)", () => {
    const r = useRemoteQuery<number>(readyResource(7, true));
    const current = r.current;
    assert(AsyncResult.isSuccess(current), "expected a Success");
    expect(current.value).toBe(7);
    expect(current.waiting).toBe(true);
  });
});
