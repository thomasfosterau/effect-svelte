import { describe, expect, expectTypeOf, it } from "vite-plus/test";
import * as root from "../src/index.js";
import type {
  ReactiveMutationReturn,
  ReactiveOptions,
  ReactiveQueryReturn,
  ReactiveStreamReturn,
  UseReactiveMutationReturn,
  UseReactiveOptions,
  UseReactiveQueryReturn,
  UseReactiveStreamReturn,
} from "../src/index.js";
import {
  useReactiveMutation,
  useReactiveQuery,
  useReactiveStream,
} from "../src/reactivity.svelte.js";

// The deprecated names are exported from the package root on purpose; these
// tests check that they stay identical to the `useReactive*` names until the
// aliases are removed.
describe("deprecated reactiveX aliases", () => {
  it("are the useReactiveX hooks under their old names, exported from the package root", () => {
    expect(root.reactiveQuery).toBe(root.useReactiveQuery);
    expect(root.reactiveStream).toBe(root.useReactiveStream);
    expect(root.reactiveMutation).toBe(root.useReactiveMutation);
    expect(root.useReactiveQuery).toBe(useReactiveQuery);
    expect(root.useReactiveStream).toBe(useReactiveStream);
    expect(root.useReactiveMutation).toBe(useReactiveMutation);
  });

  it("keep the old type names as aliases of the UseReactiveX types", () => {
    expectTypeOf<ReactiveOptions<1>>().toEqualTypeOf<UseReactiveOptions<1>>();
    expectTypeOf<ReactiveQueryReturn<1, never>>().toEqualTypeOf<UseReactiveQueryReturn<1, never>>();
    expectTypeOf<ReactiveStreamReturn<1, never>>().toEqualTypeOf<
      UseReactiveStreamReturn<1, never>
    >();
    expectTypeOf<ReactiveMutationReturn<1, never>>().toEqualTypeOf<
      UseReactiveMutationReturn<1, never>
    >();
  });
});
