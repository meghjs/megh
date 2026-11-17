import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { SwcCompiler } from "../compiler";
import { CliError } from "../errors";
import { meghDir, projectLayout } from "../utils/entry";
import { c } from "../utils/log";
import { requireProjectRoot } from "../utils/project";

export type Route = { method: string; path: string; controller: string; handler: string; file: string };
export type RouteListOptions = { cwd?: string; json?: boolean; static?: boolean };

export function joinRoute(...parts: string[]): string {
  const joined = "/" + parts.join("/");
  const normalized = joined.replace(/\/{2,}/g, "/");
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

function controllerFiles(srcDir: string): string[] {
  if (!fs.existsSync(srcDir)) return [];
  return fs
    .readdirSync(srcDir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".controller.ts"))
    .map((e) => path.join((e as any).parentPath ?? (e as any).path, e.name))
    .sort();
}

// ── Runtime: compile, require, read Megh's route metadata ───────────────

const MARKER = "__MEGH_ROUTES__";

/**
 * Runs in a child process (so the app's import side effects cannot affect the
 * CLI). Requires each compiled controller and reads the metadata written by
 * `@ApiController` (symbol "icontroller:options") and `@Get`/`@Post`/...
 * ("route:method", "route:path").
 */
const WORKER = `
const files = JSON.parse(process.argv[process.argv.length - 1]);
const out = [];
const errors = [];
for (const [src, compiled] of files) {
  let mod;
  try { mod = require(compiled); } catch (e) { errors.push(src + ": " + (e && e.message || e)); continue; }
  if (typeof Reflect.getOwnMetadataKeys !== "function") {
    errors.push("reflect-metadata is not loaded; is @meghjs/core installed?");
    break;
  }
  for (const value of Object.values(mod)) {
    if (typeof value !== "function") continue;
    const key = Reflect.getOwnMetadataKeys(value).find(
      (k) => typeof k === "symbol" && k.description === "icontroller:options");
    if (!key) continue;
    const meta = Reflect.getOwnMetadata(key, value) || {};
    const proto = value.prototype;
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === "constructor") continue;
      const method = Reflect.getMetadata("route:method", proto, name);
      if (!method) continue;
      out.push({ controllerPath: meta.path || "/", method, path: Reflect.getMetadata("route:path", proto, name) || "/",
        controller: value.name, handler: name, file: src });
    }
  }
}
console.log(${JSON.stringify(MARKER)} + JSON.stringify({ routes: out, errors }));
process.exit(0);
`;

export function runtimeRoutes(root: string): Route[] {
  const layout = projectLayout(root);
  const cacheDir = path.join(meghDir(root), "route-list");
  fs.rmSync(cacheDir, { recursive: true, force: true });
  const compiler = new SwcCompiler(layout.srcDir, cacheDir, layout.compilerOptions);
  const failures = compiler.compileAll();
  if (failures.size) {
    const list = [...failures].map(([f, e]) => `${path.relative(root, f)}: ${e.split("\n")[0]}`).join("\n  ");
    throw new CliError(`Compilation failed:\n  ${list}`);
  }
  const files = controllerFiles(layout.srcDir).map((f) => [path.relative(root, f), compiler.outFileFor(f)]);
  if (!files.length) return [];

  const result = spawnSync(process.execPath, ["-e", WORKER, JSON.stringify(files)], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? "development" },
    maxBuffer: 64 * 1024 * 1024,
  });
  const line = (result.stdout ?? "").split(/\r?\n/).find((l) => l.startsWith(MARKER));
  if (!line) {
    throw new CliError(`Could not load controllers:\n${result.stderr || result.stdout || result.error?.message}`);
  }
  const { routes, errors } = JSON.parse(line.slice(MARKER.length));
  if (errors.length) {
    throw new CliError(`Could not load controllers:\n  ${errors.join("\n  ")}\nTry --static to scan the source instead.`);
  }
  return routes.map((r: any) => ({
    method: String(r.method).toUpperCase(),
    path: joinRoute(r.controllerPath, r.path),
    controller: r.controller,
    handler: r.handler,
    file: r.file.split(path.sep).join("/"),
  }));
}

// ── Static: scan decorators in the source ─────────────────────────────────

const STRING = /^\s*(['"`])((?:(?!\1).)*)\1/;

function decoratorPath(args: string | undefined): string {
  if (!args) return "/";
  const literal = args.match(STRING);
  if (literal) return literal[2] || "/";
  const objPath = args.match(/path\s*:\s*(['"`])((?:(?!\1).)*)\1/);
  return objPath ? objPath[2] : "/";
}

/** Scan `@ApiController` classes and their `@Get`/`@Post`/... methods without running any code. */
export function scanRoutes(source: string, file: string): Route[] {
  const routes: Route[] = [];
  const ctrlRe = /@ApiController\b(?:\s*\(([^)]*)\))?[\s\S]*?\bclass\s+([A-Za-z_$][\w$]*)/g;
  const ctrls = [...source.matchAll(ctrlRe)];
  ctrls.forEach((m, i) => {
    const start = m.index! + m[0].length;
    const end = i + 1 < ctrls.length ? ctrls[i + 1].index! : source.length;
    const body = source.slice(start, end);
    const base = decoratorPath(m[1]);
    const methodRe =
      /@(Get|Post|Put|Patch|Delete|Options|All)\s*\(([^)]*)\)[\s\S]*?(?<![@\w$])([A-Za-z_$][\w$]*)\s*\(/g;
    for (const r of body.matchAll(methodRe)) {
      routes.push({
        method: r[1].toUpperCase(),
        path: joinRoute(base, decoratorPath(r[2])),
        controller: m[2],
        handler: r[3],
        file,
      });
    }
  });
  return routes;
}

export function staticRoutes(root: string): Route[] {
  const layout = projectLayout(root);
  return controllerFiles(layout.srcDir).flatMap((f) =>
    scanRoutes(fs.readFileSync(f, "utf8"), path.relative(root, f).split(path.sep).join("/")),
  );
}

// ── Command ───────────────────────────────────────────────────────────────

export function formatRoutes(routes: Route[]): string {
  if (!routes.length) return "No routes found.";
  const rows = routes.map((r) => [r.method, r.path, `${r.controller}.${r.handler}`]);
  const head = ["METHOD", "PATH", "HANDLER"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const fmt = (row: string[]) => row.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd();
  return [c.bold(fmt(head)), ...rows.map(fmt)].join("\n");
}

export function routeList(opts: RouteListOptions = {}): Route[] {
  const root = requireProjectRoot(opts.cwd ?? process.cwd());
  const routes = (opts.static ? staticRoutes(root) : runtimeRoutes(root)).sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
  console.log(opts.json ? JSON.stringify(routes, null, 2) : formatRoutes(routes));
  return routes;
}
