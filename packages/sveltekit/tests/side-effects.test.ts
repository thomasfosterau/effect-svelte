/// <reference types="vite-plus/client" />

import { describe, expect, it } from "vite-plus/test";
import { build, parseAst } from "vite-plus";
import * as Arr from "effect/Array";
import * as Match from "effect/Match";
import * as Order from "effect/Order";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";

/**
 * `package.json` declares `"sideEffects": false`, which lets a consumer's
 * bundler drop every module of this package that its imports do not reach.
 * That is what keeps `import { ResponseHeaders } from
 * "@thomasfosterau/effect-sveltekit"` in a universal `src/hooks.ts` from
 * dragging the default runtime, `HttpClient` and `Stream` into the client
 * entry (#188).
 *
 * The flag is a promise about every module, so this file guards both halves:
 * no module does anything at load beyond declaring, and a single named import
 * really does tree-shake. `pack.unbundle` maps each `src/` module 1:1 onto a
 * `dist/` module, so the source tree is the published module graph.
 */

/** Every source module, as raw text, keyed by its path relative to this file. */
const sources: Record<string, string> = import.meta.glob(["../src/**/*.ts", "!../src/**/*.d.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Top-level statement kinds that only declare. */
const declarations: ReadonlyArray<string> = [
  "ExportAllDeclaration",
  "FunctionDeclaration",
  "ClassDeclaration",
  "VariableDeclaration",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSEnumDeclaration",
  "TSDeclareFunction",
  "EmptyStatement",
];

/** Node kinds whose bodies run later, not at module load. */
const deferred: ReadonlyArray<string> = [
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
];

/** Node kinds that are an effect when evaluated at module load. */
const effectful: ReadonlyArray<string> = [
  "AwaitExpression",
  "AssignmentExpression",
  "UpdateExpression",
  "StaticBlock",
];

/**
 * Collects the effectful node kinds evaluated at load among `values`: ESTree
 * nodes, lists of nodes and scalar fields, as `parseAst` returns them.
 */
const effectsIn = (values: ReadonlyArray<unknown>): ReadonlyArray<string> =>
  Arr.flatMap(values, (value): ReadonlyArray<string> => {
    if (Arr.isArray(value)) return effectsIn(value);
    if (!Predicate.isObject(value)) return [];
    const type = Predicate.isString(value["type"]) ? value["type"] : "";
    if (Arr.contains(deferred, type)) return [];
    const nested = effectsIn(Rec.values(value));
    return Arr.contains(effectful, type) ? [type, ...nested] : nested;
  });

/** Describes each top-level statement of `source` that does more than declare. */
const topLevelEffects = (source: string): ReadonlyArray<string> =>
  Arr.flatMap(parseAst(source, { lang: "ts" }).body, (statement) => {
    const text = source.slice(statement.start, statement.end).split("\n")[0] ?? "";
    const label = (kind: string): string => `${kind}: ${text}`;
    return Match.value(statement).pipe(
      Match.when({ type: "ImportDeclaration" }, (s) =>
        Arr.isReadonlyArrayEmpty(s.specifiers) && s.importKind !== "type"
          ? [label("import for effect")]
          : [],
      ),
      Match.when({ type: Match.is("ExportNamedDeclaration", "ExportDefaultDeclaration") }, (s) =>
        Arr.map(effectsIn([s.declaration]), label),
      ),
      Match.when({ type: "TSModuleDeclaration" }, (s) => (s.declare ? [] : [label("namespace")])),
      Match.orElse((s) =>
        Arr.contains(declarations, s.type) ? Arr.map(effectsIn([s]), label) : [label(s.type)],
      ),
    );
  });

/** The package root, as a filesystem path. */
const pkgRoot = decodeURIComponent(new URL("..", import.meta.url).pathname);

/**
 * Bundles `code` (which imports from the package root as `$pkg`) the way a
 * consumer's Vite build would, and returns the package modules that contribute code to it.
 */
const bundledModules = async (
  code: string,
  moduleSideEffects?: true,
): Promise<ReadonlyArray<string>> => {
  const probe = "\0probe";
  const result = await build({
    configFile: false,
    logLevel: "silent",
    root: pkgRoot,
    plugins: [
      {
        name: "side-effects-probe",
        resolveId: (id) =>
          id === "virtual:probe" ? probe : id === "$pkg" ? `${pkgRoot}src/index.ts` : undefined,
        load: (id) => (id === probe ? code : undefined),
      },
      {
        // The control: mark every package module as having side effects,
        // overriding the package.json flag, the way a missing flag would.
        name: "side-effects-override",
        enforce: "pre",
        async resolveId(id, importer) {
          if (!moduleSideEffects || importer === undefined || !importer.startsWith(pkgRoot))
            return undefined;
          const resolved = await this.resolve(id, importer, { skipSelf: true });
          return resolved && !resolved.external
            ? { ...resolved, moduleSideEffects: true }
            : undefined;
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      rolldownOptions: {
        input: "virtual:probe",
        preserveEntrySignatures: "strict",
        // Every bare specifier (effect, @sveltejs/kit, $app/*, …) stays out of the bundle.
        external: (id) => !/^(?:[./\0]|virtual:|\$pkg$)/.test(id),
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const modules = outputs
    .flatMap((output) => ("output" in output ? output.output : []))
    .flatMap((chunk) => (chunk.type === "chunk" ? Rec.toEntries(chunk.modules) : []))
    // A module whose every binding was shaken away is still listed, with no code.
    .flatMap(([id, module]) => (module.renderedLength > 0 && id.startsWith(pkgRoot) ? [id] : []))
    .map((id) => id.slice(pkgRoot.length));
  return Arr.sort(modules, Order.String);
};

describe('"sideEffects": false', () => {
  it("finds the source modules", () => {
    expect(Rec.keys(sources)).toContain("../src/index.ts");
    expect(topLevelEffects("globalThis.x = 1;\nimport './polyfill.js';\nawait f();")).toHaveLength(
      3,
    );
  });

  it("no source module does anything at load beyond declaring", () => {
    const offenders = Rec.toEntries(sources).flatMap(([file, source]) =>
      topLevelEffects(source).map((effect) => `${file}: ${effect}`),
    );
    expect(offenders).toEqual([]);
  });

  it("a single named import from the root entry keeps only what it reaches", async () => {
    const code =
      'import { ResponseHeaders } from "$pkg"; export const headers = new ResponseHeaders();';
    expect(await bundledModules(code)).toEqual(["src/response-headers.ts", "src/transport.ts"]);
    // Control: without the flag the same import keeps the runtime and request services.
    expect(await bundledModules(code, true)).toEqual(
      expect.arrayContaining(["src/runtime.ts", "src/request-services.ts", "src/kit.ts"]),
    );
  });
});
