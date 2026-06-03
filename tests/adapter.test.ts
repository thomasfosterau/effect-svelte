import { describe, expect, it } from "vite-plus/test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Builder } from "@sveltejs/kit";
import { effectAdapter } from "../src/kit/adapter/index.js";

interface BuilderCall {
  readonly method: string;
  readonly args: ReadonlyArray<unknown>;
}

/** A minimal mock of SvelteKit's Builder that records calls and creates real directories. */
const mockBuilder = (calls: BuilderCall[]): Builder => {
  const record =
    (method: string, result?: unknown) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return result;
    };

  return {
    log: Object.assign(record("log"), {
      minor: record("log.minor"),
      info: record("log.info"),
      success: record("log.success"),
      error: record("log.error"),
      warn: record("log.warn"),
    }),
    rimraf: (dir: string) => {
      calls.push({ method: "rimraf", args: [dir] });
      rmSync(dir, { recursive: true, force: true });
    },
    mkdirp: (dir: string) => {
      calls.push({ method: "mkdirp", args: [dir] });
      mkdirSync(dir, { recursive: true });
    },
    config: { kit: { paths: { base: "" } } },
    prerendered: { paths: ["/about", "/"] },
    writeClient: record("writeClient", []),
    writePrerendered: record("writePrerendered", []),
    writeServer: record("writeServer", []),
    compress: record("compress", Promise.resolve()),
    generateManifest: ({ relativePath }: { relativePath: string }) =>
      `{"mock":true,"relativePath":${JSON.stringify(relativePath)}}`,
  } as unknown as Builder;
};

const makeOutDir = () => mkdtempSync(join(tmpdir(), "effect-adapter-out-"));

describe("effectAdapter", () => {
  it("has a name and supports read()", () => {
    const adapter = effectAdapter();
    expect(adapter.name).toBe("@thomasfosterau/effect-svelte/kit/adapter");
    expect(adapter.supports?.read?.({ config: {}, route: { id: "/" } })).toBe(true);
  });

  it("writes client, prerendered, and server output", async () => {
    const out = makeOutDir();
    const calls: BuilderCall[] = [];
    const adapter = effectAdapter({ out, precompress: false });

    await adapter.adapt(mockBuilder(calls));

    const methods = calls.map((call) => call.method);
    expect(methods).toContain("writeClient");
    expect(methods).toContain("writePrerendered");
    expect(methods).toContain("writeServer");

    const writeClient = calls.find((call) => call.method === "writeClient");
    expect(writeClient?.args[0]).toBe(`${out}/client`);
    const writeServer = calls.find((call) => call.method === "writeServer");
    expect(writeServer?.args[0]).toBe(`${out}/server`);

    rmSync(out, { recursive: true, force: true });
  });

  it("generates manifest.js with the manifest, prerendered paths, and base", async () => {
    const out = makeOutDir();
    const adapter = effectAdapter({ out, precompress: false });

    await adapter.adapt(mockBuilder([]));

    const manifest = readFileSync(join(out, "manifest.js"), "utf8");
    expect(manifest).toContain('"relativePath":"./server"');
    expect(manifest).toContain('export const prerendered = new Set(["/about","/"]);');
    expect(manifest).toContain('export const base = "";');

    rmSync(out, { recursive: true, force: true });
  });

  it("generates handler.js and index.js entries", async () => {
    const out = makeOutDir();
    const adapter = effectAdapter({ out, precompress: false, envPrefix: "MY_" });

    await adapter.adapt(mockBuilder([]));

    expect(existsSync(join(out, "handler.js"))).toBe(true);
    expect(existsSync(join(out, "index.js"))).toBe(true);

    const handler = readFileSync(join(out, "handler.js"), "utf8");
    expect(handler).toContain(
      'import { makeHandler } from "@thomasfosterau/effect-svelte/kit/adapter/handler"',
    );
    expect(handler).toContain('import { Server } from "./server/index.js"');
    expect(handler).toContain('import { manifest, prerendered, base } from "./manifest.js"');
    expect(handler).toContain('envPrefix: "MY_"');

    const entry = readFileSync(join(out, "index.js"), "utf8");
    expect(entry).toContain(
      'import { serve } from "@thomasfosterau/effect-svelte/kit/adapter/serve"',
    );
    expect(entry).toContain('import { handler } from "./handler.js"');
    expect(entry).toContain('serve(handler, { envPrefix: "MY_" });');

    rmSync(out, { recursive: true, force: true });
  });

  it("compresses assets when precompress is enabled (the default)", async () => {
    const out = makeOutDir();
    const calls: BuilderCall[] = [];
    const adapter = effectAdapter({ out });

    await adapter.adapt(mockBuilder(calls));

    const compressed = calls.filter((call) => call.method === "compress");
    expect(compressed.map((call) => call.args[0])).toEqual([`${out}/client`, `${out}/prerendered`]);

    rmSync(out, { recursive: true, force: true });
  });

  it("skips compression when precompress is disabled", async () => {
    const out = makeOutDir();
    const calls: BuilderCall[] = [];
    const adapter = effectAdapter({ out, precompress: false });

    await adapter.adapt(mockBuilder(calls));

    expect(calls.some((call) => call.method === "compress")).toBe(false);

    rmSync(out, { recursive: true, force: true });
  });

  it("respects paths.base when writing client assets", async () => {
    const out = makeOutDir();
    const calls: BuilderCall[] = [];
    const builder = mockBuilder(calls);
    (builder.config.kit.paths as { base: string }).base = "/my-app";

    const adapter = effectAdapter({ out, precompress: false });
    await adapter.adapt(builder);

    const writeClient = calls.find((call) => call.method === "writeClient");
    expect(writeClient?.args[0]).toBe(`${out}/client/my-app`);

    const manifest = readFileSync(join(out, "manifest.js"), "utf8");
    expect(manifest).toContain('export const base = "/my-app";');

    rmSync(out, { recursive: true, force: true });
  });
});
