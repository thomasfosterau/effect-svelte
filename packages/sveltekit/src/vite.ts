/**
 * Vite plugin that lets you write SvelteKit route exports as Effects (or
 * functions returning Effects) without manually wrapping them.
 *
 * ```ts
 * // vite.config.ts
 * import { sveltekit } from "@sveltejs/kit/vite";
 * import { effectKit } from "@thomasfosterau/effect-sveltekit/vite";
 *
 * export default {
 *   plugins: [effectKit(), sveltekit()],
 * };
 * ```
 *
 * ```ts
 * // +page.server.ts
 * import { Effect } from "effect";
 * import * as HttpClient from "effect/http/HttpClient";
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

import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Result from "effect/Result";
import MagicString from "magic-string";
import type { Plugin } from "vite";

const INTERNAL_IMPORT = "@thomasfosterau/effect-sveltekit/internal/auto";
const ORIG_PREFIX = "__effect_kit_orig_";
const RUNTIME_IDENT = "__effect_kit_runtime";

/** The SvelteKit route and hook file kinds `effectKit()` can rewrite. */
export type EffectKitFileKind =
  | "pageServer"
  | "page"
  | "layoutServer"
  | "layout"
  | "server"
  | "hooks"
  | "hooksServer"
  | "hooksClient";

/** File kinds whose exports only ever run on the server. */
const serverKinds: ReadonlyArray<EffectKitFileKind> = [
  "pageServer",
  "layoutServer",
  "server",
  "hooksServer",
];

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
  // Universal `src/hooks.ts`: only `reroute` is function-shaped (the `transport`
  // export is plain data and is intentionally left untouched).
  hooks: {
    reroute: "wrapReroute",
  },
};

function getFileKind(id: string): EffectKitFileKind | null {
  // Drop the query (everything from the first `?`), then normalise separators.
  const path = id.replace(/\?[\s\S]*$/, "").replace(/\\/g, "/");
  if (/\/\+page\.server\.(?:ts|js|mts|mjs)$/.test(path)) return "pageServer";
  if (/\/\+page\.(?:ts|js|mts|mjs)$/.test(path)) return "page";
  if (/\/\+layout\.server\.(?:ts|js|mts|mjs)$/.test(path)) return "layoutServer";
  if (/\/\+layout\.(?:ts|js|mts|mjs)$/.test(path)) return "layout";
  if (/\/\+server\.(?:ts|js|mts|mjs)$/.test(path)) return "server";
  if (/\/hooks\.server\.(?:ts|js|mts|mjs)$/.test(path)) return "hooksServer";
  if (/\/hooks\.client\.(?:ts|js|mts|mjs)$/.test(path)) return "hooksClient";
  // Plain `hooks.ts` is the universal hooks file; checked last so the
  // `.server.`/`.client.` variants above take precedence.
  if (/\/hooks\.(?:ts|js|mts|mjs)$/.test(path)) return "hooks";
  return null;
}

/** `text` with every character but a newline replaced by a space. */
const blank = (text: string): string => text.replace(/[^\n]/g, " ");

/**
 * A string or template literal's text, blanked: an escape (a backslash and the
 * character after it, even a newline) becomes two spaces, and every other
 * character but a newline one space.
 */
const blankLiteral = (text: string): string =>
  text.replace(/\\[\s\S]|[^\n]/g, (match) => " ".repeat(match.length));

/** A line comment, or a block comment (unterminated: to the end of the source). */
const COMMENT = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y;
/** A single- or double-quoted string (unterminated: to the end of the source). */
const QUOTED = /(["'])((?:\\[\s\S]?|(?!\1)[^\\])*)(\1?)/y;
/** A run of characters that start no comment or literal, or a lone `/`. */
const PLAIN = /[^/"'`]+|\//y;
/** Template literal text up to its closing backtick, a `${`, or the end of the source. */
const TEMPLATE_TEXT = /(?:\\[\s\S]?|\$(?!\{)|[^`\\$])*/y;

/** The text the sticky `pattern` matches at `index`, if any. */
const matchAt = (pattern: RegExp, source: string, index: number): RegExpExecArray | null => {
  pattern.lastIndex = index;
  return pattern.exec(source);
};

/**
 * The index just past the `}` closing a template expression whose body starts
 * at `from` (braces counted naively, as raw text), or the end of the source.
 */
const expressionEnd = (source: string, from: number): number => {
  let depth = 1;
  const closing = Arr.findFirst(source.slice(from).matchAll(/[{}]/g), (brace) => {
    depth += brace[0] === "{" ? 1 : -1;
    return depth === 0;
  });
  return Option.match(closing, {
    onNone: () => source.length,
    onSome: (brace) => from + brace.index + 1,
  });
};

/** Where {@link maskCommentsAndStrings} is: an offset, inside a template literal or not. */
interface MaskPosition {
  readonly index: number;
  readonly inTemplate: boolean;
}

/** The masked chunk at a position inside a template literal, and the position after it. */
const maskTemplateChunk = (source: string, index: number): readonly [string, MaskPosition] => {
  const text = matchAt(TEMPLATE_TEXT, source, index)?.[0] ?? "";
  const end = index + text.length;
  if (source.startsWith("${", end)) {
    // Keep a template expression verbatim, up to its closing brace.
    const close = expressionEnd(source, end + 2);
    return [blankLiteral(text) + source.slice(end, close), { index: close, inTemplate: true }];
  }
  // The closing backtick, or nothing at the end of the source.
  return [blankLiteral(text) + source.slice(end, end + 1), { index: end + 1, inTemplate: false }];
};

/** The masked chunk at a position outside any template literal, and the position after it. */
const maskChunk = (source: string, index: number): readonly [string, MaskPosition] => {
  const comment = matchAt(COMMENT, source, index);
  if (comment !== null) {
    return [blank(comment[0]), { index: index + comment[0].length, inTemplate: false }];
  }
  const quoted = matchAt(QUOTED, source, index);
  if (quoted !== null) {
    const [whole, quote = "", body = "", closing = ""] = quoted;
    return [
      quote + blankLiteral(body) + closing,
      { index: index + whole.length, inTemplate: false },
    ];
  }
  if (source.startsWith("`", index)) return ["`", { index: index + 1, inTemplate: true }];
  const plain = matchAt(PLAIN, source, index)?.[0] ?? source.charAt(index);
  return [plain, { index: index + plain.length, inTemplate: false }];
};

/**
 * Returns a copy of `source` with line/block comments and string/template
 * contents replaced by spaces (newlines preserved). Byte offsets in the
 * returned string line up with the original, so regex scans don't trip on
 * tokens inside comments or strings.
 */
const maskCommentsAndStrings = (source: string): string =>
  Arr.unfold<MaskPosition, string>({ index: 0, inTemplate: false }, (position) =>
    position.index >= source.length
      ? Option.none()
      : Option.some(
          position.inTemplate
            ? maskTemplateChunk(source, position.index)
            : maskChunk(source, position.index),
        ),
  ).join("");

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
function findExports(masked: string, isTarget: (name: string) => boolean): Array<ExportMatch> {
  const pattern =
    /^[ \t]*(export)[ \t]+(?:async[ \t]+)?(?:const|let|var|function)[ \t]+([A-Za-z_$][\w$]*)/gm;

  return Arr.filterMap(masked.matchAll(pattern), (m) => {
    const [full, , name] = m;
    if (name === undefined || !isTarget(name)) return Result.failVoid;

    const exportStart = m.index + full.indexOf("export");
    const nameEnd = m.index + full.length;
    const renamed = `${ORIG_PREFIX}${name}`;

    const slice = masked.slice(exportStart, nameEnd);
    const replacement = slice
      .replace(/^export[ \t]+/, "")
      .replace(new RegExp(`\\b${name}$`), renamed);

    return Result.succeed({ name, start: exportStart, end: nameEnd, replacement });
  });
}

/** Options for {@link effectKit}. */
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
   * @example "#lib/server/runtime.ts"
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
   * @example "#lib/runtime.ts"
   */
  clientRuntime?: string;
}

/**
 * Vite plugin that rewrites SvelteKit route exports so that Effects, or
 * functions returning Effects, are accepted wherever SvelteKit expects a
 * function-shaped export.
 */
export function effectKit(options: EffectKitPluginOptions = {}): Plugin {
  const { include } = options;

  return {
    name: "effect-kit",
    enforce: "pre",
    transform(code, id) {
      const kind = getFileKind(id);
      if (!kind) return null;
      if (include && !Arr.contains(include, kind)) return null;

      const wrappers = wrapperByKind[kind];

      const masked = maskCommentsAndStrings(code);
      const found = findExports(masked, (name) => Rec.has(wrappers, name));
      if (Arr.isReadonlyArrayEmpty(found)) return null;

      const s = new MagicString(code);

      Arr.forEach(found, (match) => {
        s.overwrite(match.start, match.end, match.replacement);
      });

      const wrapperImports = Arr.dedupe(
        Arr.filterMap(found, (m) => Result.fromOption(Rec.get(wrappers, m.name), () => m.name)),
      );

      // Server-only files get the server runtime module; universal/client
      // files get the client runtime module (it must be browser-safe).
      const runtimeSpecifier = Arr.contains(serverKinds, kind)
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
