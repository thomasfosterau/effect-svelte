/**
 * `Navigation`'s promise wrappers against the `$app/navigation` stand-in: a
 * rejection (or a synchronous throw, as Kit's server build does) lands on the
 * error channel as a `NavigationError` carrying the operation and the original
 * cause, never as a defect.
 */

import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { afterEach, assert, describe, expect, it } from "vite-plus/test";
import * as Navigation from "../../src/Navigation.js";
import { navigationStubs, resetNavigationStubs } from "./fixtures/app-navigation.js";

afterEach(resetNavigationStubs);

/**
 * Runs `effect` and returns the single error it failed with on the error
 * channel (a `Fail` reason), asserting it did not die.
 */
const failureOf = async <E>(effect: Effect.Effect<unknown, E, never>): Promise<E> => {
  const exit = await Effect.runPromise(Effect.exit(effect));
  assert(Exit.isFailure(exit), "expected the effect to fail");
  expect(Cause.hasDies(exit.cause)).toBe(false);
  expect(exit.cause.reasons).toHaveLength(1);
  const [reason] = exit.cause.reasons;
  assert(reason !== undefined && Cause.isFailReason(reason), "expected a single Fail reason");
  return reason.error;
};

type Operation = keyof typeof navigationStubs;

/**
 * Each wrapper, a call to it, and the arguments that call must forward to
 * SvelteKit unchanged (options included).
 */
const wrappers: ReadonlyArray<
  readonly [
    Operation,
    () => Effect.Effect<unknown, Navigation.NavigationError>,
    ReadonlyArray<unknown>,
  ]
> = [
  [
    "goto",
    () => Navigation.goto("/done", { replace: true, refreshAll: true }),
    ["/done", { replace: true, refreshAll: true }],
  ],
  ["invalidate", () => Navigation.invalidate("app:todos", true), ["app:todos", true]],
  ["invalidateAll", () => Navigation.invalidateAll(), []],
  ["refreshAll", () => Navigation.refreshAll(), []],
  ["preloadData", () => Navigation.preloadData("/blog"), ["/blog"]],
  ["preloadCode", () => Navigation.preloadCode("/blog/[slug]"), ["/blog/[slug]"]],
];

describe("Navigation promise wrappers: success", () => {
  it.each(wrappers)(
    "%s forwards its arguments and succeeds",
    async (operation, run, expectedArgs) => {
      const calls: Array<Array<unknown>> = [];
      navigationStubs[operation] = (...args) => {
        calls.push(args);
        return Promise.resolve();
      };

      await Effect.runPromise(run());
      expect(calls).toEqual([expectedArgs]);
    },
  );

  it("preloadData succeeds with SvelteKit's result", async () => {
    const result = { type: "redirect" as const, status: 307, location: "/login" };
    navigationStubs.preloadData = () => Promise.resolve(result);

    expect(await Effect.runPromise(Navigation.preloadData("/admin"))).toBe(result);
  });
});

describe("Navigation promise wrappers: failure", () => {
  it.each(wrappers)(
    "%s fails with a NavigationError carrying the rejection",
    async (operation, run) => {
      const cause = new Error(`${operation} rejected`);
      navigationStubs[operation] = () => Promise.reject(cause);

      const error = await failureOf(run());
      expect(error).toMatchObject({ _tag: "NavigationError", operation, cause });
    },
  );

  it.each(wrappers)(
    "%s fails with a NavigationError when SvelteKit throws synchronously",
    async (operation, run) => {
      // Kit's server build throws synchronously (`server_api_unavailable`);
      // `invalidate` also throws synchronously on an unparseable URL.
      const cause = new Error(`Cannot call ${operation}(...) on the server`);
      navigationStubs[operation] = () => {
        throw cause;
      };

      const error = await failureOf(run());
      expect(error).toMatchObject({ _tag: "NavigationError", operation, cause });
    },
  );

  it("is a NavigationError instance that Effect.catchTag recovers from", async () => {
    const cause = new Error("https://svelte.dev/e/kit/navigation_route_missing");
    navigationStubs.goto = () => Promise.reject(cause);

    const error = await failureOf(Navigation.goto("/nowhere"));
    expect(error).toBeInstanceOf(Navigation.NavigationError);

    const recovered = await Effect.runPromise(
      Navigation.goto("/nowhere").pipe(
        Effect.as("navigated"),
        Effect.catchTag("NavigationError", (e) => Effect.succeed(`${e.operation} failed`)),
      ),
    );
    expect(recovered).toBe("goto failed");
  });
});
