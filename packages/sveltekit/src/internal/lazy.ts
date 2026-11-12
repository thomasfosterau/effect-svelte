import * as Option from "effect/Option";

/**
 * A thunk that calls `build` on its first call and returns that same value on
 * every later one. A `build` that throws caches nothing, so the next call
 * tries again.
 */
export const lazy = <A>(build: () => A): (() => A) => {
  // `None` until the first call has built the value.
  let cell: Option.Option<A> = Option.none();
  return () =>
    Option.getOrElse(cell, () => {
      const value = build();
      cell = Option.some(value);
      return value;
    });
};
