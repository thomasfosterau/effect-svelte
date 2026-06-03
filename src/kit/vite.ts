/**
 * Vite plugin that lets you write SvelteKit route exports as Effects (or
 * functions returning Effects) without manually wrapping them.
 *
 * ```ts
 * // vite.config.ts
 * import { sveltekit } from "@sveltejs/kit/vite";
 * import { effectKit } from "@thomasfosterau/effect-svelte/kit/vite";
 *
 * export default {
 *   plugins: [effectKit(), sveltekit()],
 * };
 * ```
 *
 * ```ts
 * // +page.server.ts
 * import { Effect } from "effect";
 * import * as HttpClient from "effect/unstable/http/HttpClient";
 *
 * export const load = (event) =>
 *   Effect.gen(function* () {
 *     const client = yield* HttpClient.HttpClient;
 *     return { hello: "world" };
 *   });
 * ```
 *
 * Under the hood the plugin rewrites the export to call the same wrappers
 * that the explicit API (`serverLoad`, `actions`, `handle`, `endpoint`, ...)
 * uses. Plain functions that return promises or values pass through
 * unchanged, so the plugin is safe to enable on existing projects.
 */

import MagicString from "magic-string";
import type { Plugin } from "vite";

const INTERNAL_IMPORT = "@thomasfosterau/effect-svelte/kit/internal/auto";
const ORIG_PREFIX = "__effect_kit_orig_";
const RUNTIME_IDENT = "__effect_kit_runtime";

export type EffectKitFileKind =
  | "pageServer"
  | "page"
  | "layoutServer"
  | "layout"
  | "server"
  | "hooksServer"
  | "hooksClient";

/** File kinds whose exports only ever run on the server. */
const serverKinds: ReadonlySet<EffectKitFileKind> = new Set([
  "pageServer",
  "layoutServer",
  "server",
  "hooksServer",
]);

const wrapperByKind: Record<EffectKitFileKind, Record<string, string>> = {
  pageServer: { load: "wrapServerLoad", actions: "wrapActions" },
  page: { load: "wrapLoad" },
  layoutServer: { load: "wrapServerLoad" },
  layout: { load: "wrapLoad" },
  server: {
    GET: "wrapEndpoint",
    POST: "wrapEndpoint",
    PUT: "wrapEndpoint",
    PATCH: "wrapEndpoint",
    DELETE: "wrapEndpoint",
    OPTIONS: "wrapEndpoint",
    HEAD: "wrapEndpoint",
    fallback: "wrapEndpoint",
  },
  hooksServer: {
    handle: "wrapHandle",
    handleFetch: "wrapHandleFetch",
    handleError: "wrapHandleError",
    init: "wrapInit",
  },
  hooksClient: {
    handleError: "wrapHandleError",
    init: "wrapInit",
  },
};

function getFileKind(id: string): EffectKitFileKind | null {
  const path = id.split("?")[0]!.replace(/\\/g, "/");
  if (/\/\+page\.server\.(?:ts|js|mts|mjs)$/.test(path)) return "pageServer";
  if (/\/\+page\.(?:ts|js|mts|mjs)$/.test(path)) return "page";
  if (/\/\+layout\.server\.(?:ts|js|mts|mjs)$/.test(path)) return "layoutServer";
  if (/\/\+layout\.(?:ts|js|mts|mjs)$/.test(path)) return "layout";
  if (/\/\+server\.(?:ts|js|mts|mjs)$/.test(path)) return "server";
  if (/\/hooks\.server\.(?:ts|js|mts|mjs)$/.test(path)) return "hooksServer";
  if (/\/hooks\.client\.(?:ts|js|mts|mjs)$/.test(path)) return "hooksClient";
  return null;
}

/**
 * Returns a copy of `source` with line/block comments and string/template
 * contents replaced by spaces (newlines preserved). Byte offsets in the
 * returned string line up with the original, so regex scans don't trip on
 * tokens inside comments or strings.
 */
function maskCommentsAndStrings(source: string): string {
  const out: string[] = [];
  let i = 0;
  const len = source.length;

  while (i < len) {
    const c = source[i]!;
    const next = source[i + 1];

    if (c === "/" && next === "/") {
      out.push("  ");
      i += 2;
      while (i < len && source[i] !== "\n") {
        out.push(" ");
        i++;
      }
      continue;
    }

    if (c === "/" && next === "*") {
      out.push("  ");
      i += 2;
      while (i < len && !(source[i] === "*" && source[i + 1] === "/")) {
        out.push(source[i] === "\n" ? "\n" : " ");
        i++;
      }
      if (i < len) {
        out.push("  ");
        i += 2;
      }
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      out.push(quote);
      i++;
      while (i < len && source[i] !== quote) {
        if (source[i] === "\\" && i + 1 < len) {
          out.push("  ");
          i += 2;
          continue;
        }
        out.push(source[i] === "\n" ? "\n" : " ");
        i++;
      }
      if (i < len) {
        out.push(quote);
        i++;
      }
      continue;
    }

    if (c === "`") {
      out.push("`");
      i++;
      while (i < len && source[i] !== "`") {
        if (source[i] === "\\" && i + 1 < len) {
          out.push("  ");
          i += 2;
          continue;
        }
        if (source[i] === "$" && source[i + 1] === "{") {
          // Preserve template expression so nested strings are masked by
          // the outer loop.
          out.push("${");
          i += 2;
          let depth = 1;
          while (i < len && depth > 0) {
            out.push(source[i]!);
            if (source[i] === "{") depth++;
            else if (source[i] === "}") depth--;
            i++;
          }
          continue;
        }
        out.push(source[i] === "\n" ? "\n" : " ");
        i++;
      }
      if (i < len) {
        out.push("`");
        i++;
      }
      continue;
    }

    out.push(c);
    i++;
  }

  return out.join("");
}

interface ExportMatch {
  name: string;
  start: number;
  end: number;
  replacement: string;
}

/**
 * Find top-level `export const|let|var|function NAME` declarations whose
 * NAME is in `targetNames`. Returns the slice of the original source to
 * replace, along with a renamed declaration to put in its place.
 *
 * `export { NAME }`, `export default`, and destructuring forms are not
 * supported — users who need them should use the explicit wrappers.
 */
function findExports(masked: string, targetNames: ReadonlySet<string>): ExportMatch[] {
  const matches: ExportMatch[] = [];
  const pattern =
    /^[ \t]*(export)[ \t]+(?:async[ \t]+)?(?:const|let|var|function)[ \t]+([A-Za-z_$][\w$]*)/gm;

  let m: RegExpExecArray | null;
  while ((m = pattern.exec(masked))) {
    const [full, , name] = m;
    if (!targetNames.has(name!)) continue;

    const exportStart = m.index + full.indexOf("export");
    const nameEnd = m.index + full.length;
    const renamed = `${ORIG_PREFIX}${name}`;

    const slice = masked.slice(exportStart, nameEnd);
    const replacement = slice
      .replace(/^export[ \t]+/, "")
      .replace(new RegExp(`\\b${name}$`), renamed);

    matches.push({ name: name!, start: exportStart, end: nameEnd, replacement });
  }

  return matches;
}

export interface EffectKitPluginOptions {
  /**
   * Restrict transformation to a subset of SvelteKit file kinds.
   * Defaults to all standard route files.
   */
  include?: ReadonlyArray<EffectKitFileKind>;

  /**
   * Import specifier of a server-only module whose `runtime` (or default)
   * export is an app-wide runtime created with `makeServerRuntime`.
   *
   * When set, Effects returned from server route files (`+page.server.ts`,
   * `+layout.server.ts`, `+server.ts`, `hooks.server.ts`) have access to the
   * services of that runtime's layer.
   *
   * @example "$lib/server/runtime"
   */
  serverRuntime?: string;

  /**
   * Import specifier of a universal module whose `runtime` (or default)
   * export is an app-wide runtime created with `makeUniversalRuntime`.
   *
   * When set, Effects returned from universal route files (`+page.ts`,
   * `+layout.ts`, `hooks.client.ts`) have access to the services of that
   * runtime's layer. The module must be safe to import in the browser.
   *
   * @example "$lib/runtime"
   */
  clientRuntime?: string;
}

/**
 * Vite plugin that rewrites SvelteKit route exports so that Effects, or
 * functions returning Effects, are accepted wherever SvelteKit expects a
 * function-shaped export.
 */
export function effectKit(options: EffectKitPluginOptions = {}): Plugin {
  const include = options.include ? new Set(options.include) : null;

  return {
    name: "effect-kit",
    enforce: "pre",
    transform(code, id) {
      const kind = getFileKind(id);
      if (!kind) return null;
      if (include && !include.has(kind)) return null;

      const wrappers = wrapperByKind[kind];
      const targetNames = new Set(Object.keys(wrappers));

      const masked = maskCommentsAndStrings(code);
      const found = findExports(masked, targetNames);
      if (found.length === 0) return null;

      const s = new MagicString(code);

      for (const match of found) {
        s.overwrite(match.start, match.end, match.replacement);
      }

      const wrapperImports = Array.from(new Set(found.map((m) => wrappers[m.name]!)));

      // Server-only files get the server runtime module; universal/client
      // files get the client runtime module (it must be browser-safe).
      const runtimeSpecifier = serverKinds.has(kind)
        ? options.serverRuntime
        : options.clientRuntime;

      const imports =
        `\nimport { ${wrapperImports.join(", ")} } from ${JSON.stringify(INTERNAL_IMPORT)};\n` +
        (runtimeSpecifier
          ? `import * as ${RUNTIME_IDENT} from ${JSON.stringify(runtimeSpecifier)};\n`
          : "");
      const runtimeArg = runtimeSpecifier ? `, ${RUNTIME_IDENT}` : "";
      const exports = found
        .map(
          (m) =>
            `export const ${m.name} = ${wrappers[m.name]}(${ORIG_PREFIX}${m.name}${runtimeArg});`,
        )
        .join("\n");

      s.append(`\n${imports}${exports}\n`);

      return {
        code: s.toString(),
        map: s.generateMap({ hires: "boundary", source: id }),
      };
    },
  };
}

export default effectKit;
