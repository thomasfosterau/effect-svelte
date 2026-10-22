import { assert, describe, expect, it } from "vite-plus/test";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { effectKit, type EffectKitPluginOptions } from "../src/vite.js";

/** The part of a `transform` hook result these tests read: the rewritten module. */
const TransformedModule = Schema.NullOr(Schema.Struct({ code: Schema.String }));

/** Runs the plugin's `transform` hook on `code` (as module `id`), or `null` if it is left alone. */
function runTransform(code: string, id: string, options?: EffectKitPluginOptions) {
  const plugin = effectKit(options);
  const transform = plugin.transform;
  if (!Predicate.isFunction(transform)) throw new Error("expected transform function");
  // SAFETY: `effectKit`'s transform hook never reads its plugin context
  // (`this`), so an empty object stands in for it.
  const context = {} as ThisParameterType<typeof transform>;
  return Schema.decodeUnknownSync(TransformedModule)(transform.call(context, code, id));
}

/** Like {@link runTransform}, asserting the hook rewrote the module. */
function transformed(code: string, id: string, options?: EffectKitPluginOptions) {
  const result = runTransform(code, id, options);
  assert(result !== null, "expected the plugin to transform the module");
  return result;
}

describe("effectKit() vite plugin", () => {
  it("returns null for non-SvelteKit files", () => {
    const result = runTransform(`export const load = () => 1;`, "/app/src/lib/foo.ts");
    expect(result).toBeNull();
  });

  it("returns null when no target exports are present", () => {
    const result = runTransform(
      `export const prerender = true;\nexport const trailingSlash = "always";\n`,
      "/app/src/routes/foo/+page.server.ts",
    );
    expect(result).toBeNull();
  });

  it("wraps a `load` export in +page.server.ts", () => {
    const result = transformed(
      `import { Effect } from "effect";\nexport const load = (event) => Effect.succeed({ ok: true });\n`,
      "/app/src/routes/foo/+page.server.ts",
    );
    expect(result).not.toBeNull();
    expect(result.code).toContain("const __effect_kit_orig_load");
    expect(result.code).toContain("wrapServerLoad(__effect_kit_orig_load)");
    expect(result.code).toContain("@thomasfosterau/effect-sveltekit/internal/auto");
    // The renamed declaration replaces the original export
    expect(result.code).not.toMatch(/export\s+const\s+load\s*=\s*\(event\)/);
    // But the re-export is present
    expect(result.code).toContain("export const load = wrapServerLoad(__effect_kit_orig_load);");
  });

  it("wraps `actions` in +page.server.ts", () => {
    const result = transformed(
      `export const actions = { default: (event) => null };\n`,
      "/app/src/routes/foo/+page.server.ts",
    );
    expect(result.code).toContain("wrapActions(__effect_kit_orig_actions)");
  });

  it("wraps universal `load` in +page.ts with wrapLoad", () => {
    const result = transformed(
      `export const load = (event) => ({ ok: true });\n`,
      "/app/src/routes/foo/+page.ts",
    );
    expect(result.code).toContain("wrapLoad(__effect_kit_orig_load)");
    expect(result.code).not.toContain("wrapServerLoad");
  });

  it("wraps multiple HTTP method exports in +server.ts", () => {
    const result = transformed(
      `export const GET = (event) => new Response();\n` +
        `export async function POST(event) { return new Response(); }\n`,
      "/app/src/routes/api/+server.ts",
    );
    expect(result.code).toContain("wrapEndpoint(__effect_kit_orig_GET)");
    expect(result.code).toContain("wrapEndpoint(__effect_kit_orig_POST)");
    expect(result.code).toContain("async function __effect_kit_orig_POST");
  });

  it("wraps `handle` in hooks.server.ts", () => {
    const result = transformed(
      `export const handle = ({ event, resolve }) => resolve(event);\n`,
      "/app/src/hooks.server.ts",
    );
    expect(result.code).toContain("wrapHandle(__effect_kit_orig_handle)");
  });

  it("only imports needed wrappers (deduped)", () => {
    const result = transformed(
      `export const GET = () => new Response();\nexport const POST = () => new Response();\n`,
      "/app/src/routes/api/+server.ts",
    );
    const importLine = result.code.match(/import \{ ([^}]+) \} from/);
    expect(importLine).not.toBeNull();
    assert(importLine !== null, "expected a wrapper import line");
    const imported = importLine[1];
    assert(imported !== undefined, "expected the import line to name wrappers");
    const importedNames = imported.split(",").map((s: string) => s.trim());
    expect(importedNames).toEqual(["wrapEndpoint"]);
  });

  it("does NOT match `export const load` inside string literals", () => {
    const result = transformed(
      `const docs = "export const load = something";\nexport const load = () => 1;\n`,
      "/app/src/routes/foo/+page.server.ts",
    );
    // It should still wrap the real one
    expect(result.code).toContain("wrapServerLoad(__effect_kit_orig_load)");
    // But the original string content should be intact
    expect(result.code).toContain('"export const load = something"');
  });

  it("does NOT match `export const load` inside comments", () => {
    const result = transformed(
      `// export const load = nope\n/* export const load = also-nope */\nexport const load = () => 1;\n`,
      "/app/src/routes/foo/+page.server.ts",
    );
    // The real load is still wrapped
    expect(result.code).toContain("wrapServerLoad(__effect_kit_orig_load)");
    // Only one rename occurred
    const matches = result.code.match(/__effect_kit_orig_load/g) || [];
    expect(matches.length).toBe(2); // declaration + reference in re-export
  });

  it("preserves declaration kind", () => {
    const fnResult = transformed(
      `export function GET() { return new Response(); }\n`,
      "/app/src/routes/api/+server.ts",
    );
    expect(fnResult.code).toContain("function __effect_kit_orig_GET");

    const letResult = transformed(
      `export let load = () => 1;\n`,
      "/app/src/routes/foo/+page.server.ts",
    );
    expect(letResult.code).toContain("let __effect_kit_orig_load");
  });

  it("does not touch non-target exports", () => {
    const result = transformed(
      `export const prerender = true;\nexport const ssr = false;\nexport const load = () => 1;\n`,
      "/app/src/routes/foo/+page.server.ts",
    );
    expect(result.code).toContain("export const prerender = true;");
    expect(result.code).toContain("export const ssr = false;");
  });

  it("wraps `reroute` in the universal hooks.ts", () => {
    const result = transformed(
      `export const reroute = (event) => (event.url.pathname === "/old" ? "/new" : undefined);\n`,
      "/app/src/hooks.ts",
    );
    expect(result).not.toBeNull();
    expect(result.code).toContain("wrapReroute(__effect_kit_orig_reroute)");
  });

  it("does not touch `transport` (plain data) in hooks.ts", () => {
    const result = runTransform(
      `export const transport = { Date: { encode: () => false, decode: (x) => x } };\n`,
      "/app/src/hooks.ts",
    );
    // No function-shaped exports to wrap -> the plugin leaves the file alone.
    expect(result).toBeNull();
  });

  it("plain hooks.ts kind does not match hooks.server.ts / hooks.client.ts", () => {
    const server = runTransform(
      `export const reroute = (event) => undefined;\n`,
      "/app/src/hooks.server.ts",
    );
    // `reroute` is not a server-hooks target, so hooks.server.ts is untouched.
    expect(server).toBeNull();
  });

  it("hooks.client.ts wraps handleError and init but not handle", () => {
    const result = transformed(
      `export const handleError = (e) => null;\n` +
        `export const init = () => {};\n` +
        `export const handle = () => null;\n`,
      "/app/src/hooks.client.ts",
    );
    expect(result.code).toContain("wrapHandleError(__effect_kit_orig_handleError)");
    expect(result.code).toContain("wrapInit(__effect_kit_orig_init)");
    // handle is NOT a hook on the client — it should be left alone
    expect(result.code).toContain("export const handle = ()");
    expect(result.code).not.toContain("wrapHandle(__effect_kit_orig_handle)");
  });
});

describe("effectKit() runtime module options", () => {
  const serverCode = `export const load = (event) => null;\n`;

  it("injects the serverRuntime module into server route files", () => {
    const result = transformed(serverCode, "/app/src/routes/foo/+page.server.ts", {
      serverRuntime: "#lib/server/runtime.ts",
    });
    expect(result.code).toContain(
      'import * as __effect_kit_runtime from "#lib/server/runtime.ts";',
    );
    expect(result.code).toContain(
      "export const load = wrapServerLoad(__effect_kit_orig_load, __effect_kit_runtime);",
    );
  });

  it("injects the serverRuntime module into hooks.server.ts", () => {
    const result = transformed(
      `export const handle = ({ event, resolve }) => resolve(event);\n`,
      "/app/src/hooks.server.ts",
      { serverRuntime: "#lib/server/runtime.ts" },
    );
    expect(result.code).toContain(
      'import * as __effect_kit_runtime from "#lib/server/runtime.ts";',
    );
    expect(result.code).toContain("wrapHandle(__effect_kit_orig_handle, __effect_kit_runtime)");
  });

  it("injects the clientRuntime module into universal route files", () => {
    const result = transformed(serverCode, "/app/src/routes/foo/+page.ts", {
      serverRuntime: "#lib/server/runtime.ts",
      clientRuntime: "#lib/runtime.ts",
    });
    expect(result.code).toContain('import * as __effect_kit_runtime from "#lib/runtime.ts";');
    expect(result.code).toContain(
      "export const load = wrapLoad(__effect_kit_orig_load, __effect_kit_runtime);",
    );
    // The server runtime must never leak into universal (client-reachable) files.
    expect(result.code).not.toContain("#lib/server/runtime.ts");
  });

  it("does not inject the serverRuntime into universal files when no clientRuntime is set", () => {
    const result = transformed(serverCode, "/app/src/routes/foo/+page.ts", {
      serverRuntime: "#lib/server/runtime.ts",
    });
    expect(result.code).not.toContain("__effect_kit_runtime");
    expect(result.code).toContain("export const load = wrapLoad(__effect_kit_orig_load);");
  });

  it("does not inject anything when no runtime options are set", () => {
    const result = transformed(serverCode, "/app/src/routes/foo/+page.server.ts");
    expect(result.code).not.toContain("__effect_kit_runtime");
    expect(result.code).toContain("export const load = wrapServerLoad(__effect_kit_orig_load);");
  });
});
