import { describe, expect, it } from "vite-plus/test";
import { readdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, posix } from "node:path";

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

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");

/** Recursively collect files under `dir`, returned as POSIX paths relative to `dir`. */
function collect(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = join(entry.parentPath ?? entry.path, entry.name);
    out.push(
      posix.normalize(
        abs
          .slice(dir.length + 1)
          .split("\\")
          .join("/"),
      ),
    );
  }
  return out;
}

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

  it("no source module builds to a name kit would treat as a remote module", () => {
    // Under `unbundle: true` (see vite.config.ts) dist mirrors src filenames, so
    // the source tree is the source of truth for the published module names.
    const offenders = collect(join(pkgRoot, "src"))
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
      // model the built output name (`.ts` -> `.js`)
      .map((f) => f.replace(/\.ts$/, ".js"))
      .filter((f) => REMOTE_MODULE_PATTERN.test(f));

    expect(offenders).toEqual([]);
  });

  it("no built dist module matches the remote-module matcher (when dist is present)", () => {
    const dist = join(pkgRoot, "dist");
    if (!existsSync(dist)) return; // dist is only present after `vp pack`
    const offenders = collect(dist).filter(
      (f) => (f.endsWith(".js") || f.endsWith(".d.ts")) && REMOTE_MODULE_PATTERN.test(f),
    );
    expect(offenders).toEqual([]);
  });
});
