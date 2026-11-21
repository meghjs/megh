/**
 * @copyright 2024
 * @author Tareq Hossain
 * @email xtrinsic96@gmail.com
 * @url https://github.com/xtareq
 */
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";

/**
 * Extensions accepted for uploads when no allowlist is configured. Anything a
 * browser would execute when served from a static directory (html, svg, js,
 * xml, ...) is deliberately absent.
 */
export const DEFAULT_ALLOWED_UPLOAD_EXTENSIONS: readonly string[] = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".avif",
  ".bmp",
  ".pdf",
  ".txt",
  ".csv",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".odt",
  ".ods",
  ".zip",
  ".mp3",
  ".wav",
  ".mp4",
  ".webm",
  ".mov",
];

/**
 * Resolve `target` inside `baseDir` following symlinks, and return its real
 * path, or `null` when it, or a symlink on the way, leads outside `baseDir`.
 * Throws (ENOENT) when the target doesn't exist.
 */
export async function resolveRealWithin(
  baseDir: string,
  target: string,
): Promise<string | null> {
  const candidate = resolveWithin(baseDir, target);
  if (!candidate) return null;
  const [real, realBase] = await Promise.all([
    fs.promises.realpath(candidate),
    fs.promises.realpath(baseDir),
  ]);
  return resolveWithin(realBase, real) ? real : null;
}

/**
 * Resolve `target` against `baseDir` and return the absolute path, or `null`
 * when the result escapes `baseDir`. Unlike a plain `startsWith(baseDir)`
 * check, a sibling such as `<baseDir>-evil` is rejected.
 */
export function resolveWithin(
  baseDir: string,
  target: string,
  allowBase = false,
): string | null {
  if (typeof target !== "string" || target.includes("\0")) return null;
  const base = path.resolve(baseDir);
  const full = path.resolve(base, target);
  const rel = path.relative(base, full);
  if (rel === "") return allowBase ? full : null;
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    return null;
  }
  return full;
}

/**
 * True when `filename` is a single, plain path segment: non-empty, no
 * separators, no `..`, no null bytes.
 */
export function isSafeFilename(filename: unknown): filename is string {
  return (
    typeof filename === "string" &&
    filename.trim() !== "" &&
    filename !== "." &&
    !filename.includes("..") &&
    !filename.includes("/") &&
    !filename.includes("\\") &&
    !filename.includes("\0")
  );
}

/** Lower-cased extension of `filename`, including the dot (`""` if none). */
export function fileExtension(filename: string): string {
  return path.extname(filename).toLowerCase();
}

/** A random filename that keeps `ext` (e.g. `".png"`). */
export function randomFilename(ext: string): string {
  return randomUUID() + ext;
}

/**
 * Build a `Content-Disposition: attachment` value that cannot inject headers:
 * the plain `filename` keeps only safe ASCII, and the real name is carried in
 * the RFC 5987 `filename*` parameter.
 */
export function contentDisposition(filename: string): string {
  const name =
    String(filename ?? "")
      .split(/[\/\\]/)
      .pop() || "file";
  const ascii =
    name
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["\\;]/g, "_")
      .trim() || "file";
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * True when the process runs TypeScript sources directly: ts-node, tsx,
 * @swc-node and other require hooks (which register `.ts`), or a `.ts` entry
 * file run through a loader or Node's type stripping.
 */
export function isTypeScriptRuntime(): boolean {
  if (process.env.TS_NODE_DEV || process.env.TS_NODE_PROJECT) return true;
  if ((process as any)[Symbol.for("ts-node.register.instance")]) return true;
  if (typeof require !== "undefined" && require.extensions?.[".ts"]) {
    return true;
  }
  return /\.[cm]?tsx?$/i.test(process.argv[1] ?? "");
}

/** The source and output folders from the project's tsconfig. */
export interface SourceLayout {
  /** `compilerOptions.rootDir`, relative to the project root. */
  rootDir?: string;
  /** `compilerOptions.outDir`, relative to the project root. */
  outDir?: string;
}

/**
 * Read `rootDir` / `outDir` from `tsconfig.build.json` (what `megh build`
 * compiles with) or `tsconfig.json` in `root`, following relative `extends`.
 * Returns `{}` when there is no readable tsconfig.
 */
export function readSourceLayout(root = process.cwd()): SourceLayout {
  for (const name of ["tsconfig.build.json", "tsconfig.json"]) {
    const file = path.join(root, name);
    if (fs.existsSync(file)) return layoutFromConfig(file, root, 0);
  }
  return {};
}

function layoutFromConfig(
  file: string,
  root: string,
  depth: number,
): SourceLayout {
  let config: any;
  try {
    config = parseJsonc(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
  const options = config?.compilerOptions ?? {};
  const dir = path.dirname(file);
  const rel = (p: unknown) =>
    typeof p === "string"
      ? path.relative(root, path.resolve(dir, p)) || "."
      : undefined;
  const own: SourceLayout = {
    rootDir: rel(options.rootDir),
    outDir: rel(options.outDir),
  };
  const parent =
    typeof config?.extends === "string" ? config.extends : undefined;
  if (depth < 5 && parent?.startsWith(".")) {
    const parentFile = path.resolve(
      dir,
      parent.endsWith(".json") ? parent : parent + ".json",
    );
    if (fs.existsSync(parentFile)) {
      const inherited = layoutFromConfig(parentFile, root, depth + 1);
      return {
        rootDir: own.rootDir ?? inherited.rootDir,
        outDir: own.outDir ?? inherited.outDir,
      };
    }
  }
  return own;
}

/** JSON with comments and trailing commas, as tsconfig allows. */
function parseJsonc(text: string): unknown {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === "\"") inString = false;
    } else if (c === "\"") {
      inString = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      if (i === -1) break;
      i++;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/**
 * Absolute directory for a project-relative source path such as
 * `src/controllers`. When TypeScript runs directly the path is used as is.
 * Otherwise the compiled output is read: the tsconfig `rootDir` (default
 * `src`) is swapped for its `outDir` (default `dist`). When `rootDir` isn't
 * set, tsc may keep the `src` folder inside `outDir` (`dist/src/...`), so
 * that is tried too. Only a leading segment changes: a `src` elsewhere in
 * the path (`app/src/controllers`) is left alone.
 */
export function resolveSourceDir(
  dir: string,
  isTsNode: boolean,
  layout: SourceLayout = readSourceLayout(),
): string {
  const root = process.cwd();
  if (isTsNode || path.isAbsolute(dir)) return path.resolve(root, dir);
  const segments = path
    .normalize(dir)
    .split(path.sep)
    .filter((s) => s !== ".");
  const rootDir = path.normalize(layout.rootDir ?? "src").split(path.sep);
  const outDir = path.normalize(layout.outDir ?? "dist");
  const underRoot =
    rootDir[0] === "." ||
    rootDir.every((segment, i) => segments[i] === segment);
  if (!underRoot) return path.join(root, ...segments);

  const rest = rootDir[0] === "." ? segments : segments.slice(rootDir.length);
  const candidates = [path.join(root, outDir, ...rest)];
  if (layout.rootDir === undefined) {
    // No rootDir: tsc mirrors the common source root, which can keep `src`.
    candidates.push(path.join(root, outDir, ...segments));
  }
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0];
}
