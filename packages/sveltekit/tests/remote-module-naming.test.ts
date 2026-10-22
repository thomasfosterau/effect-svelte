import { describe, expect, it } from "vite-plus/test";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

/**
 * SvelteKit v3's remote-functions subsystem treats any module whose path matches
 * this pattern as a *remote module* and validates, at build/import time, that
 * **every** export is a remote function (`query` / `command` / `form` /
 * `prerender` / ...). This is the exact matcher from
 * `@sveltejs/kit@3.0.0-next.11` (`src/exports/vite/utils.js`); it was broadened
 * from `3.0.0-next.10`'s `endsWith('.remote' + ext)` check, which is why a file
 * such as `remote.server.js` — previously ignored — is now matched.
 *
 * This package must therefore never publish a module whose path matches this
 * pattern: its files export factories/types (e.g. `RemoteFunction`), not remote
 * functions, so kit would reject the whole build with
 * "all exports from this file must be remote functions". A consumer's own
 * `*.remote.ts` files are the real remote modules; ours are plain library code.
 *
 * Regression guard for:
 *   `RemoteFunction` exported from dist/remote.server.js is invalid —
 *   all exports from this file must be remote functions
 */
const REMOTE_MODULE_PATTERN = /[/.]remote(\.[^/]+)+$/;

/** Runs `effect` with Node's `FileSystem` and `Path` services provided. */
const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

/** The package root (the parent of this `tests/` directory). */
const pkgRoot = Effect.fn("pkgRoot")(function* () {
  const path = yield* Path.Path;
  return yield* path.fromFileUrl(new URL("..", import.meta.url));
});

/** Recursively collect files under `dir`, returned as POSIX paths relative to `dir`. */
const collect = Effect.fn("collect")(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!(yield* fs.exists(dir))) return [];
  const entries = yield* fs.readDirectory(dir, { recursive: true });
  const files = yield* Effect.filter(entries, (entry) =>
    Effect.map(fs.stat(path.join(dir, entry)), (info) => info.type === "File"),
  );
  return Arr.map(files, (file) => path.normalize(file).replaceAll("\\", "/"));
});

describe("published module naming vs SvelteKit remote-module matcher", () => {
  it("sanity-checks the matcher against known cases", () => {
    // A consumer's real remote module (correctly matched by kit).
    expect(REMOTE_MODULE_PATTERN.test("src/routes/data.remote.ts")).toBe(true);
    // The historical offender that broke the consumer build.
    expect(REMOTE_MODULE_PATTERN.test("dist/remote.server.js")).toBe(true);
    // Our replacement name — and other hyphenated `remote-*` files — must not match.
    expect(REMOTE_MODULE_PATTERN.test("dist/remote-functions.js")).toBe(false);
    expect(REMOTE_MODULE_PATTERN.test("dist/remote-reactive.js")).toBe(false);
  });

  it("no source module builds to a name kit would treat as a remote module", () =>
    run(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        // Under `unbundle: true` (see vite.config.ts) dist mirrors src filenames, so
        // the source tree is the source of truth for the published module names.
        const offenders = (yield* collect(path.join(yield* pkgRoot(), "src")))
          .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
          // model the built output name (`.ts` -> `.js`)
          .map((f) => f.replace(/\.ts$/, ".js"))
          .filter((f) => REMOTE_MODULE_PATTERN.test(f));

        expect(offenders).toEqual([]);
      }),
    ));

  it("no built dist module matches the remote-module matcher (when dist is present)", () =>
    run(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        // dist is only present after `vp pack`; `collect` finds nothing without it.
        const offenders = (yield* collect(path.join(yield* pkgRoot(), "dist"))).filter(
          (f) => (f.endsWith(".js") || f.endsWith(".d.ts")) && REMOTE_MODULE_PATTERN.test(f),
        );
        expect(offenders).toEqual([]);
      }),
    ));
});
