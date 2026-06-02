import { describe, expect, it } from "vite-plus/test";
import { effectKit } from "../src/kit/vite.js";

function runTransform(code: string, id: string) {
  const plugin = effectKit();
  const transform = plugin.transform as any;
  if (typeof transform !== "function") throw new Error("expected transform function");
  const result = transform.call({}, code, id);
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
    const result = runTransform(
      `import { Effect } from "effect";\nexport const load = (event) => Effect.succeed({ ok: true });\n`,
      "/app/src/routes/foo/+page.server.ts",
    );
    expect(result).not.toBeNull();
    expect(result.code).toContain("const __effect_kit_orig_load");
    expect(result.code).toContain("wrapServerLoad(__effect_kit_orig_load)");
    expect(result.code).toContain("@thomasfosterau/effect-svelte/kit/internal/auto");
    // The renamed declaration replaces the original export
    expect(result.code).not.toMatch(/export\s+const\s+load\s*=\s*\(event\)/);
    // But the re-export is present
    expect(result.code).toContain("export const load = wrapServerLoad(__effect_kit_orig_load);");
  });

  it("wraps `actions` in +page.server.ts", () => {
    const result = runTransform(
      `export const actions = { default: (event) => null };\n`,
      "/app/src/routes/foo/+page.server.ts",
    );
    expect(result.code).toContain("wrapActions(__effect_kit_orig_actions)");
  });

  it("wraps universal `load` in +page.ts with wrapLoad", () => {
    const result = runTransform(
      `export const load = (event) => ({ ok: true });\n`,
      "/app/src/routes/foo/+page.ts",
    );
    expect(result.code).toContain("wrapLoad(__effect_kit_orig_load)");
    expect(result.code).not.toContain("wrapServerLoad");
  });

  it("wraps multiple HTTP method exports in +server.ts", () => {
    const result = runTransform(
      `export const GET = (event) => new Response();\n` +
        `export async function POST(event) { return new Response(); }\n`,
      "/app/src/routes/api/+server.ts",
    );
    expect(result.code).toContain("wrapEndpoint(__effect_kit_orig_GET)");
    expect(result.code).toContain("wrapEndpoint(__effect_kit_orig_POST)");
    expect(result.code).toContain("async function __effect_kit_orig_POST");
  });

  it("wraps `handle` in hooks.server.ts", () => {
    const result = runTransform(
      `export const handle = ({ event, resolve }) => resolve(event);\n`,
      "/app/src/hooks.server.ts",
    );
    expect(result.code).toContain("wrapHandle(__effect_kit_orig_handle)");
  });

  it("only imports needed wrappers (deduped)", () => {
    const result = runTransform(
      `export const GET = () => new Response();\nexport const POST = () => new Response();\n`,
      "/app/src/routes/api/+server.ts",
    );
    const importLine = result.code.match(/import \{ ([^}]+) \} from/);
    expect(importLine).not.toBeNull();
    const importedNames = importLine![1].split(",").map((s: string) => s.trim());
    expect(importedNames).toEqual(["wrapEndpoint"]);
  });

  it("does NOT match `export const load` inside string literals", () => {
    const result = runTransform(
      `const docs = "export const load = something";\nexport const load = () => 1;\n`,
      "/app/src/routes/foo/+page.server.ts",
    );
    // It should still wrap the real one
    expect(result.code).toContain("wrapServerLoad(__effect_kit_orig_load)");
    // But the original string content should be intact
    expect(result.code).toContain('"export const load = something"');
  });

  it("does NOT match `export const load` inside comments", () => {
    const result = runTransform(
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
    const fnResult = runTransform(
      `export function GET() { return new Response(); }\n`,
      "/app/src/routes/api/+server.ts",
    );
    expect(fnResult.code).toContain("function __effect_kit_orig_GET");

    const letResult = runTransform(
      `export let load = () => 1;\n`,
      "/app/src/routes/foo/+page.server.ts",
    );
    expect(letResult.code).toContain("let __effect_kit_orig_load");
  });

  it("does not touch non-target exports", () => {
    const result = runTransform(
      `export const prerender = true;\nexport const ssr = false;\nexport const load = () => 1;\n`,
      "/app/src/routes/foo/+page.server.ts",
    );
    expect(result.code).toContain("export const prerender = true;");
    expect(result.code).toContain("export const ssr = false;");
  });

  it("hooks.client.ts wraps handleError and init but not handle", () => {
    const result = runTransform(
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
