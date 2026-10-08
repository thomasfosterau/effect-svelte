/**
 * `Navigation`'s promise wrappers against the `$app/navigation` stand-in: a
 * rejection (or a synchronous throw, as Kit's server build does) lands on the
 * error channel as a `NavigationError` carrying the operation and the original
 * cause, never as a defect.
 */

import { Cause, Effect, Exit } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import * as Navigation from "../../src/Navigation.js";
import { navigationStubs, resetNavigationStubs } from "./fixtures/app-navigation.js";

afterEach(resetNavigationStubs);

/**
 * Runs `effect` and returns the single error it failed with on the error
 * channel (a `Fail` reason), asserting it did not die.
 */
const failureOf = async (effect: Effect.Effect<unknown, unknown, never>): Promise<unknown> => {
  const exit = await Effect.runPromise(Effect.exit(effect));
  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) return undefined;
  expect(Cause.hasDies(exit.cause)).toBe(false);
  expect(exit.cause.reasons).toHaveLength(1);
  const [reason] = exit.cause.reasons;
  expect(reason !== undefined && Cause.isFailReason(reason)).toBe(true);
  return reason !== undefined && Cause.isFailReason(reason) ? reason.error : undefined;
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
    const result = { type: "redirect", status: 307, location: "/login" };
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
