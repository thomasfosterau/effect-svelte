import { describe, expect, it } from "vite-plus/test";
import { Cause, Deferred, Effect, Exit, Fiber, Queue } from "effect";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { failQueueOnSetupError } from "../src/internal/stream-callback.js";

// These tests exercise the helper directly rather than through a
// `Stream.callback` site: from `effect@4.0.2` on, `Stream.callback` forwards a
// failed setup itself, so a test that only goes through the stream passes with
// or without the helper. On 4.0.0 and 4.0.1, which the peer floor admitted until
// #164 raised it to 4.0.2, the helper is what kept the stream from hanging; #168
// tracks removing it.
describe("failQueueOnSetupError", () => {
  it("fails the queue with a setup's defect, and the setup itself succeeds", async () => {
    const thrown = new Error("setup threw");

    const { setup, offered, taken } = await Effect.runPromise(
      Effect.gen(function* () {
        const queue = yield* Queue.make<number, Cause.Done>();
        const setup = yield* Effect.exit(
          Effect.sync(() => {
            throw thrown;
          }).pipe(failQueueOnSetupError(queue)),
        );
        // `false` means the queue is already done. Offering first also keeps a
        // broken helper from hanging the `take` below: it then yields this value.
        const offered = yield* Queue.offer(queue, 0);
        const taken = yield* Effect.exit(Queue.take(queue));
        return { setup, offered, taken };
      }),
    );

    expect(Exit.isSuccess(setup)).toBe(true);
    expect(offered).toBe(false);
    if (Exit.isSuccess(taken)) throw new Error("expected take to die");
    const [reason, ...rest] = taken.cause.reasons;
    expect(rest).toEqual([]);
    if (reason === undefined || !Cause.isDieReason(reason)) {
      throw new Error(`expected a defect, got ${Cause.pretty(taken.cause)}`);
    }
    expect(reason.defect).toBe(thrown);
  });

  it("fails the queue with a setup's typed failure", async () => {
    const { setup, offered, taken } = await Effect.runPromise(
      Effect.gen(function* () {
        const queue = yield* Queue.make<number, "setup failed" | Cause.Done>();
        const setup = yield* Effect.exit(
          Effect.fail("setup failed" as const).pipe(failQueueOnSetupError(queue)),
        );
        const offered = yield* Queue.offer(queue, 0);
        const taken = yield* Effect.exit(Queue.take(queue));
        return { setup, offered, taken };
      }),
    );

    expect(Exit.isSuccess(setup)).toBe(true);
    expect(offered).toBe(false);
    if (Exit.isSuccess(taken)) throw new Error("expected take to fail");
    const [reason, ...rest] = taken.cause.reasons;
    expect(rest).toEqual([]);
    if (reason === undefined || !Cause.isFailReason(reason)) {
      throw new Error(`expected a typed failure, got ${Cause.pretty(taken.cause)}`);
    }
    expect(reason.error).toBe("setup failed");
  });

  it("leaves the queue open when the setup succeeds", async () => {
    const taken = await Effect.runPromise(
      Effect.gen(function* () {
        const queue = yield* Queue.make<number, Cause.Done>();
        yield* Effect.void.pipe(failQueueOnSetupError(queue));
        yield* Queue.offer(queue, 1);
        return yield* Queue.take(queue);
      }),
    );

    expect(taken).toBe(1);
  });

  it("leaves the queue open when the setup's fiber is interrupted", async () => {
    // This is how a setup normally ends: the stream's scope closes and
    // interrupts it. That must not turn into a failure of the queue.
    const { offered, taken } = await Effect.runPromise(
      Effect.gen(function* () {
        const queue = yield* Queue.make<number, Cause.Done>();
        const started = yield* Deferred.make<void>();
        const fiber = yield* Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          failQueueOnSetupError(queue),
          Effect.forkChild,
        );
        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        const offered = yield* Queue.offer(queue, 1);
        const taken = yield* Queue.take(queue);
        return { offered, taken };
      }),
    );

    expect(offered).toBe(true);
    expect(taken).toBe(1);
  });
});

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/**
 * Returns `source` with every comment and string/template literal replaced by
 * spaces (newlines kept), so code-only searches skip prose and string contents
 * and offsets still line up. Regex literals are not recognised; one containing
 * a quote or comment opener would throw the scan off.
 */
function blankCommentsAndStrings(source: string): string {
  let out = "";
  let i = 0;
  const blank = (end: number): void => {
    out += source.slice(i, end).replace(/[^\n]/g, " ");
    i = end;
  };
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      blank(end === -1 ? source.length : end);
    } else if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      blank(end === -1 ? source.length : end + 2);
    } else if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) j += source[j] === "\\" ? 2 : 1;
      blank(Math.min(j + 1, source.length));
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/** Returns the index just past the bracket that closes the one at `open`, or -1. */
function closingIndex(code: string, open: number, opener: string, closer: string): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === opener) depth++;
    else if (code[i] === closer && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * Call-site guard: every `Stream.callback` call in `src/` must route its setup
 * through `failQueueOnSetupError`, or a failed setup hangs the stream on
 * `effect` 4.0.0 and 4.0.1 (below the peer floor since #164; #168 tracks
 * removing the helper and this guard).
 *
 * Heuristic: in each `.ts` file under `src/`, with comments and strings blanked
 * out, find every `Stream.callback`, skip an optional `<…>` type argument list,
 * require a `(` next, take the text up to the matching `)` (the whole call
 * expression, options included) and require `failQueueOnSetupError(` in it.
 * Anything else after `Stream.callback` (a bare reference, an unbalanced call,
 * a type argument containing `=>`) is reported rather than skipped, so for the
 * call shapes it recognises the guard errs towards a false alarm. It misses
 * `callback` imported from `effect/Stream` under another name, `Stream . callback`
 * written with spaces, and the helper placed in the options argument rather than
 * the setup; this package only uses formatted `Stream.callback(setup, …)` calls.
 */
describe("Stream.callback call sites", () => {
  const files = readdirSync(srcDir, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".ts"))
    .map((path) => join(srcDir, path));

  const sites: { site: string; guarded: boolean }[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const code = blankCommentsAndStrings(source);
    for (const match of code.matchAll(/\bStream\.callback\b/g)) {
      const line = source.slice(0, match.index).split("\n").length;
      const site = `${relative(srcDir, file)}:${line}`;
      let at = match.index + match[0].length;
      while (/\s/.test(code[at] ?? "")) at++;
      if (code[at] === "<") {
        at = closingIndex(code, at, "<", ">");
        while (at !== -1 && /\s/.test(code[at] ?? "")) at++;
      }
      const end = at !== -1 && code[at] === "(" ? closingIndex(code, at, "(", ")") : -1;
      sites.push({
        site,
        guarded: end !== -1 && code.slice(at, end).includes("failQueueOnSetupError("),
      });
    }
  }

  it("finds the package's call sites", () => {
    // Guards the heuristic itself: if it stopped finding the known sites (the
    // `$app/state` bridge, `fromEventSource` and `fromWebSocket`), the check
    // below would pass vacuously.
    const found = sites.map(({ site }) => site.slice(0, site.lastIndexOf(":")).replace(/\\/g, "/"));
    expect(found.filter((file) => file === "internal/app-state.ts").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(found.filter((file) => file === "realtime.ts").length).toBeGreaterThanOrEqual(2);
  });

  it("routes every setup through failQueueOnSetupError", () => {
    expect(sites.filter(({ guarded }) => !guarded).map(({ site }) => site)).toEqual([]);
  });
});
