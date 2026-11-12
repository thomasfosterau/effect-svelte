import { it } from "@effect/vitest";
import { describe, expect } from "vite-plus/test";
import type { Builder } from "@sveltejs/kit";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import { type BuildOptions, writeBuild } from "../src/adapter/build.js";
import { effectAdapter } from "../src/adapter/index.js";
import { ForeignError } from "./fixtures/foreign-error.js";

interface BuilderCall {
  readonly method: string;
  readonly args: ReadonlyArray<unknown>;
}

/** The members of SvelteKit's `Builder` that `effectAdapter`'s `adapt` reads. */
type AdaptBuilder = Pick<
  Builder,
  | "log"
  | "writeClient"
  | "writePrerendered"
  | "writeServer"
  | "compress"
  | "getAppPath"
  | "generateServerInstance"
> & {
  readonly config: { readonly paths: { readonly base: Builder["config"]["paths"]["base"] } };
  readonly prerendered: Pick<Builder["prerendered"], "paths">;
};

/**
 * A minimal mock of SvelteKit's Builder that records calls and writes nothing.
 * `compress` returns what `compressed` gives.
 */
const mockBuilder = (
  calls: BuilderCall[],
  base: Builder["config"]["paths"]["base"] = "",
  compressed: () => ReturnType<Builder["compress"]> = () => Promise.resolve([]),
): Builder => {
  const record =
    <R>(method: string, result: R) =>
    (...args: Array<string>): R => {
      calls.push({ method, args });
      return result;
    };

  const prettyError: Builder["log"]["prettyError"] = (error, caller) => {
    calls.push({ method: "log.prettyError", args: [error, caller] });
  };

  const builder: AdaptBuilder = {
    log: Object.assign(record("log", undefined), {
      minor: record("log.minor", undefined),
      info: record("log.info", undefined),
      success: record("log.success", undefined),
      error: record("log.error", undefined),
      warn: record("log.warn", undefined),
      err: record("log.err", undefined),
      prettyError,
    }),
    config: { paths: { base } },
    prerendered: { paths: ["/about", "/"] },
    writeClient: record("writeClient", []),
    writePrerendered: record("writePrerendered", []),
    writeServer: record("writeServer", []),
    compress: (directory) => {
      calls.push({ method: "compress", args: [directory] });
      return compressed();
    },
    getAppPath: () => "_app",
    generateServerInstance: (dest, opts) => {
      calls.push({ method: "generateServerInstance", args: [dest, opts] });
    },
  };
  // SAFETY: `effectAdapter`'s `adapt` reads only the `AdaptBuilder` members of
  // the builder (see `src/adapter/index.ts`), so the rest are never touched.
  return builder as Builder;
};

/**
 * Runs `test` against a fresh temporary output directory, removed afterwards,
 * with Node's `FileSystem` and `Path` services provided.
 */
const withOutDir = <A, E>(
  test: (out: string) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
): Effect.Effect<A, E | PlatformError.PlatformError> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const out = yield* fs.makeTempDirectoryScoped({ prefix: "effect-adapter-out-" });
    return yield* test(out);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

/** Runs the adapter's `adapt` against `builder`; a rejection fails the effect. */
const adapt = (adapter: ReturnType<typeof effectAdapter>, builder: Builder) =>
  Effect.tryPromise(() => Promise.resolve(adapter.adapt(builder)));

/**
 * A `FileSystem` that performs nothing and records `remove`, `makeDirectory`
 * and `writeFileString` in `calls`, beside the builder's own calls.
 */
const recordingFileSystem = (calls: BuilderCall[]): Layer.Layer<FileSystem.FileSystem> => {
  const record =
    (method: string) =>
    (path: string): Effect.Effect<void> =>
      Effect.sync(() => {
        calls.push({ method, args: [path] });
      });
  return FileSystem.layerNoop({
    remove: record("fs.remove"),
    makeDirectory: record("fs.makeDirectory"),
    writeFileString: record("fs.writeFileString"),
  });
};

const buildOptions: BuildOptions = {
  out: "out",
  precompress: true,
  envPrefix: "",
  target: "node",
};

describe("effectAdapter", () => {
  it("has a name and supports read()", () => {
    const adapter = effectAdapter();
    expect(adapter.name).toBe("@thomasfosterau/effect-sveltekit/adapter");
    expect(adapter.supports?.read?.({ config: {}, route: { id: "/" } })).toBe(true);
  });

  it.effect("writes client, prerendered, and server output", () =>
    withOutDir(
      Effect.fn("writesOutput")(function* (out) {
        const calls: BuilderCall[] = [];
        const adapter = effectAdapter({ out, precompress: false });

        yield* adapt(adapter, mockBuilder(calls));

        const methods = calls.map((call) => call.method);
        expect(methods).toContain("writeClient");
        expect(methods).toContain("writePrerendered");
        expect(methods).toContain("writeServer");

        const writeClient = calls.find((call) => call.method === "writeClient");
        expect(writeClient?.args[0]).toBe(`${out}/client`);
        const writeServer = calls.find((call) => call.method === "writeServer");
        expect(writeServer?.args[0]).toBe(`${out}/server`);
      }),
    ),
  );

  it.effect("generates server.js from the server output", () =>
    withOutDir(
      Effect.fn("generatesServer")(function* (out) {
        const calls: BuilderCall[] = [];
        const adapter = effectAdapter({ out, precompress: false });

        yield* adapt(adapter, mockBuilder(calls));

        const generate = calls.find((call) => call.method === "generateServerInstance");
        expect(generate?.args).toEqual([`${out}/server.js`, { serverDirectory: `${out}/server` }]);
      }),
    ),
  );

  it.effect("empties the output directory before it writes anything into it", () =>
    withOutDir(
      Effect.fn("emptiesOut")(function* (out) {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.writeFileString(path.join(out, "stale.js"), "stale");

        yield* adapt(effectAdapter({ out, precompress: false }), mockBuilder([]));

        expect(yield* fs.exists(path.join(out, "stale.js"))).toBe(false);
        expect(yield* fs.exists(path.join(out, "manifest.js"))).toBe(true);
      }),
    ),
  );

  // SvelteKit's `generateServerInstance` writes `server.js` synchronously, so
  // it must run after the output directory is emptied, or the file is lost.
  it.effect("runs every build step in order, one after another", () =>
    Effect.gen(function* () {
      const calls: BuilderCall[] = [];

      yield* writeBuild(mockBuilder(calls), buildOptions).pipe(
        Effect.provide(recordingFileSystem(calls)),
      );

      expect(calls.map((call) => [call.method, call.args[0]])).toEqual([
        ["fs.remove", "out"],
        ["fs.makeDirectory", "out"],
        ["log.minor", "Copying assets"],
        ["writeClient", "out/client"],
        ["writePrerendered", "out/prerendered"],
        ["log.minor", "Compressing assets"],
        ["compress", "out/client"],
        ["compress", "out/prerendered"],
        ["log.minor", "Building server"],
        ["writeServer", "out/server"],
        ["generateServerInstance", "out/server.js"],
        ["fs.writeFileString", "out/manifest.js"],
        ["log.minor", "Writing server entry"],
        ["fs.writeFileString", "out/handler.js"],
        ["fs.writeFileString", "out/index.js"],
      ]);
    }),
  );

  it.effect("fails with the PlatformError of a file operation that failed", () =>
    Effect.gen(function* () {
      const calls: BuilderCall[] = [];
      const denied = PlatformError.systemError({
        _tag: "PermissionDenied",
        module: "FileSystem",
        method: "makeDirectory",
      });

      const error = yield* writeBuild(mockBuilder(calls), buildOptions).pipe(
        Effect.provide(FileSystem.layerNoop({ makeDirectory: () => Effect.fail(denied) })),
        Effect.flip,
      );

      expect(error).toBe(denied);
      // Nothing is written once a step has failed.
      expect(calls).toEqual([]);
    }),
  );

  it.effect("rejects with the PlatformError when the output directory cannot be made", () =>
    withOutDir(
      Effect.fn("rejectsPlatformError")(function* (dir) {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const file = path.join(dir, "file");
        yield* fs.writeFileString(file, "not a directory");
        const calls: BuilderCall[] = [];
        const adapter = effectAdapter({ out: path.join(file, "out"), precompress: false });

        const error = yield* Effect.flip(adapt(adapter, mockBuilder(calls)));

        expect(error.cause).toMatchObject({ _tag: "PlatformError" });
        expect(calls).toEqual([]);
      }),
    ),
  );

  it.effect("rejects with what the builder's compress rejected with", () =>
    withOutDir(
      Effect.fn("rejectsCompress")(function* (out) {
        const failure = new ForeignError("compress failed");
        const builder = mockBuilder([], "", () => Promise.reject(failure));

        const error = yield* Effect.flip(adapt(effectAdapter({ out }), builder));

        expect(error.cause).toBe(failure);
      }),
    ),
  );

  it.effect("generates manifest.js with the prerendered paths, base, and app path", () =>
    withOutDir(
      Effect.fn("generatesManifest")(function* (out) {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const adapter = effectAdapter({ out, precompress: false });

        yield* adapt(adapter, mockBuilder([]));

        const manifest = yield* fs.readFileString(path.join(out, "manifest.js"));
        expect(manifest).toContain('export const prerendered = new Set(["/about","/"]);');
        expect(manifest).toContain('export const base = "";');
        expect(manifest).toContain('export const appPath = "_app";');
      }),
    ),
  );

  it.effect("generates handler.js and index.js entries", () =>
    withOutDir(
      Effect.fn("generatesEntries")(function* (out) {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const adapter = effectAdapter({ out, precompress: false, envPrefix: "MY_" });

        yield* adapt(adapter, mockBuilder([]));

        expect(yield* fs.exists(path.join(out, "handler.js"))).toBe(true);
        expect(yield* fs.exists(path.join(out, "index.js"))).toBe(true);

        const handler = yield* fs.readFileString(path.join(out, "handler.js"));
        expect(handler).toContain(
          'import { makeHandler } from "@thomasfosterau/effect-sveltekit/adapter/handler"',
        );
        expect(handler).toContain('import { server } from "./server.js"');
        expect(handler).toContain('import { prerendered, base, appPath } from "./manifest.js"');
        expect(handler).toContain('envPrefix: "MY_"');

        const entry = yield* fs.readFileString(path.join(out, "index.js"));
        expect(entry).toContain(
          'import { serve } from "@thomasfosterau/effect-sveltekit/adapter/serve"',
        );
        expect(entry).toContain('import { handler } from "./handler.js"');
        expect(entry).toContain('serve(handler, { envPrefix: "MY_" });');
      }),
    ),
  );

  it.effect("generates a Cloudflare Workers fetch entry for target: 'fetch'", () =>
    withOutDir(
      Effect.fn("generatesFetchEntry")(function* (out) {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const adapter = effectAdapter({
          out,
          precompress: false,
          target: "fetch",
          envPrefix: "CF_",
        });

        yield* adapt(adapter, mockBuilder([]));

        // handler.js (the HttpApp) is still written for both targets.
        expect(yield* fs.exists(path.join(out, "handler.js"))).toBe(true);

        const entry = yield* fs.readFileString(path.join(out, "index.js"));
        expect(entry).toContain(
          'import { makeHandlerWith, AssetSource, toWebHandler } from "@thomasfosterau/effect-sveltekit/adapter/handler"',
        );
        expect(entry).toContain("AssetSource.cloudflareAssets(env.ASSETS)");
        expect(entry).toContain("export default {");
        expect(entry).toContain("fetch(request, env, ctx)");
        expect(entry).toContain('envPrefix: "CF_"');
        // The Node serve entry is not used for the fetch target.
        expect(entry).not.toContain("/adapter/serve");
      }),
    ),
  );

  it("reports read() as unsupported for the fetch target", () => {
    const adapter = effectAdapter({ target: "fetch" });
    expect(adapter.supports?.read?.({ config: {}, route: { id: "/" } })).toBe(false);
  });

  it.effect("compresses assets when precompress is enabled (the default)", () =>
    withOutDir(
      Effect.fn("compresses")(function* (out) {
        const calls: BuilderCall[] = [];
        const adapter = effectAdapter({ out });

        yield* adapt(adapter, mockBuilder(calls));

        const compressed = calls.filter((call) => call.method === "compress");
        expect(compressed.map((call) => call.args[0])).toEqual([
          `${out}/client`,
          `${out}/prerendered`,
        ]);
      }),
    ),
  );

  it.effect("skips compression when precompress is disabled", () =>
    withOutDir(
      Effect.fn("skipsCompression")(function* (out) {
        const calls: BuilderCall[] = [];
        const adapter = effectAdapter({ out, precompress: false });

        yield* adapt(adapter, mockBuilder(calls));

        expect(calls.some((call) => call.method === "compress")).toBe(false);
      }),
    ),
  );

  it.effect("respects paths.base when writing client assets", () =>
    withOutDir(
      Effect.fn("respectsBase")(function* (out) {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const calls: BuilderCall[] = [];
        const builder = mockBuilder(calls, "/my-app");

        const adapter = effectAdapter({ out, precompress: false });
        yield* adapt(adapter, builder);

        const writeClient = calls.find((call) => call.method === "writeClient");
        expect(writeClient?.args[0]).toBe(`${out}/client/my-app`);

        const manifest = yield* fs.readFileString(path.join(out, "manifest.js"));
        expect(manifest).toContain('export const base = "/my-app";');
      }),
    ),
  );
});
