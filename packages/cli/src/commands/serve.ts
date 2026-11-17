import { ChildProcess, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { SwcCompiler, isTestFile, isTsSource } from "../compiler";
import { CliError } from "../errors";
import { devBuildDir, entryCandidates, projectLayout, resolveEntry } from "../utils/entry";
import { c, tagged } from "../utils/log";
import { findTsc, killTree, treeSpawnOptions } from "../utils/process";
import { copyAssets, isAsset, readPackageJson, requireProjectRoot } from "../utils/project";

export type ServeOptions = {
  cwd?: string;
  /** Entry file (relative to the project root), overriding package.json. */
  entry?: string;
  /** Run `tsc --noEmit --watch` alongside the server. Default true. */
  typeCheck?: boolean;
  /** Milliseconds to wait for more file events before rebuilding. Default 200. */
  debounce?: number;
};

const logServe = tagged("SERVE", c.cyan);
const logApp = tagged("MEGH", c.green);
const logWatch = tagged("WATCH", c.yellow);
const logErr = (category: string) => tagged(category, c.red);

/**
 * Development server: transpiles `src/` with SWC into `.megh/build`, copies
 * assets, runs the entry file, and restarts it on changes to sources, assets
 * or `.env*` files. Type errors are reported by a parallel `tsc --watch` and
 * never block a reload; syntax errors do, and stop the running app so stale
 * JS never keeps serving.
 */
export async function serve(opts: ServeOptions = {}): Promise<void> {
  const root = requireProjectRoot(opts.cwd ?? process.cwd());
  const layout = projectLayout(root);
  const pkg = readPackageJson(root);
  if (!fs.existsSync(layout.srcDir)) throw new CliError(`Source directory ${layout.srcDir} does not exist.`);

  // Its own folder, not outDir: `megh build` output (dist/) stays untouched,
  // and a build while the server runs doesn't delete what it runs from.
  const buildDir = devBuildDir(root);
  fs.rmSync(buildDir, { recursive: true, force: true });
  const compiler = new SwcCompiler(layout.srcDir, buildDir, layout.compilerOptions);
  const candidates = entryCandidates(layout, pkg, opts.entry, buildDir);
  const debounceMs = opts.debounce ?? 200;
  const failures = new Map<string, string>();

  let app: ChildProcess | null = null;
  let stopping = false;
  let typeChecker: ChildProcess | null = null;
  const watchers: Array<{ close(): Promise<void> }> = [];

  console.log(c.bold(c.cyan("Megh development server")));
  logServe(`Project: ${root}`);

  // ── Initial build ───────────────────────────────────────────────────────
  const started = Date.now();
  for (const [file, error] of compiler.compileAll()) failures.set(file, error);
  copyAssets(layout.srcDir, buildDir);
  logServe(`Compiled in ${Date.now() - started}ms`);

  // ── App process ─────────────────────────────────────────────────────────
  async function stopApp() {
    if (!app) return;
    const child = app;
    app = null;
    stopping = true;
    await killTree(child);
    stopping = false;
  }

  function startApp() {
    const entry = resolveEntry(candidates, opts.entry);
    if (!entry) {
      logErr("MEGH")(
        `No entry file found. Tried:\n  ${candidates.map((p) => path.relative(root, p)).join("\n  ")}\n` +
          `Set "megh": { "entry": "dist/serve.js" } or "main" in package.json, or pass --entry. ` +
          `megh serve runs it from ${path.relative(root, buildDir)}/.`,
      );
      return;
    }
    logApp(`Starting ${path.relative(root, entry)}`);
    const child = spawn(process.execPath, ["--enable-source-maps", entry], {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV ?? "development",
        // Where auto-discovery (controllers, tasks) finds the compiled code.
        MEGH_BUILD_DIR: buildDir,
      },
      ...treeSpawnOptions,
    });
    app = child;
    child.on("exit", (code, signal) => {
      if (app === child) app = null;
      if (stopping) return;
      if (code) logErr("MEGH")(`Process exited with code ${code}. Waiting for changes...`);
      else if (signal) logApp(`Process terminated by ${signal}. Waiting for changes...`);
    });
    child.on("error", (err) => logErr("MEGH")(`Failed to start: ${err.message}`));
  }

  function reportFailures() {
    for (const [file, error] of failures) {
      logErr("COMPILE")(`${path.relative(root, file)}\n${error}`);
    }
    logErr("COMPILE")(
      `${failures.size} file(s) failed to compile. The app is stopped until they are fixed.`,
    );
  }

  // Serialize restarts so overlapping events never race.
  let chain = Promise.resolve();
  const enqueue = (task: () => Promise<void> | void) => {
    chain = chain.then(task).catch((err) => logErr("SERVE")(String(err?.stack ?? err)));
    return chain;
  };

  async function reload() {
    await stopApp();
    if (failures.size) return reportFailures();
    startApp();
  }

  // ── Change handling (debounced) ─────────────────────────────────────────
  const pending = new Map<string, string>();
  let timer: NodeJS.Timeout | null = null;

  function onEvent(event: string, file: string) {
    pending.set(file, event);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const batch = new Map(pending);
      pending.clear();
      enqueue(() => applyBatch(batch));
    }, debounceMs);
  }

  const outPath = (file: string) => path.join(buildDir, path.relative(layout.srcDir, file));
  const inSrc = (file: string) => {
    const rel = path.relative(layout.srcDir, file);
    return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
  };

  /**
   * Mirror one file event into the output dir. Returns true when the app
   * should restart; test files, `.d.ts` and dotfiles are ignored.
   */
  function applyChange(event: string, file: string): boolean {
    if (path.dirname(file) === root && path.basename(file).startsWith(".env")) return true;
    if (!inSrc(file)) return false;

    if (event === "unlinkDir") {
      fs.rmSync(outPath(file), { recursive: true, force: true });
      for (const f of failures.keys()) if (f.startsWith(file + path.sep)) failures.delete(f);
      return true;
    }
    if (event === "addDir") return false;

    if (isTsSource(file)) {
      if (isTestFile(file)) return false;
      if (event === "unlink") {
        fs.rmSync(compiler.outFileFor(file), { force: true });
        failures.delete(file);
        return true;
      }
      const result = compiler.compileFile(file);
      if (result.ok) failures.delete(file);
      else failures.set(file, result.error);
      return true;
    }

    if (!isAsset(file)) return false;
    if (event === "unlink") {
      fs.rmSync(outPath(file), { force: true });
    } else {
      fs.mkdirSync(path.dirname(outPath(file)), { recursive: true });
      fs.copyFileSync(file, outPath(file));
    }
    return true;
  }

  async function applyBatch(batch: Map<string, string>) {
    let relevant = false;
    for (const [file, event] of batch) {
      if (applyChange(event, file)) {
        relevant = true;
        logWatch(`${event} ${path.relative(root, file)}`);
      }
    }
    if (relevant) await reload();
  }

  // ── Watchers ────────────────────────────────────────────────────────────
  const chokidar = require("chokidar") as typeof import("chokidar");
  const srcWatcher = chokidar.watch(layout.srcDir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });
  const envWatcher = chokidar.watch(root, {
    ignoreInitial: true,
    depth: 0,
    ignored: (p: string) => p !== root && !path.basename(p).startsWith(".env"),
  });
  for (const w of [srcWatcher, envWatcher]) {
    w.on("all", (event, file) => onEvent(event, file));
    w.on("error", (err) => logErr("WATCH")(String((err as Error)?.message ?? err)));
    watchers.push(w);
  }

  // ── Type checking ───────────────────────────────────────────────────────
  if (opts.typeCheck !== false) {
    const tsc = findTsc(root);
    if (!tsc || !layout.tsconfig) {
      logServe(c.yellow("Type checking disabled: TypeScript or tsconfig.json not found in the project."));
    } else {
      typeChecker = spawn(
        process.execPath,
        [tsc, "--noEmit", "--watch", "--preserveWatchOutput", "--pretty", "-p", layout.tsconfig],
        { cwd: root, stdio: ["ignore", "pipe", "pipe"], ...treeSpawnOptions },
      );
      const forward = (data: Buffer) => {
        for (const line of data.toString().split(/\r?\n/)) {
          // Skip tsc's per-cycle "Starting compilation" / "File change detected" chatter.
          if (!line.trim() || /Starting (incremental )?compilation|File change detected/.test(line)) continue;
          console.log(`${c.dim("[TSC]")} ${/Found 0 errors/.test(line) ? c.green(line) : line}`);
        }
      };
      typeChecker.stdout?.on("data", forward);
      typeChecker.stderr?.on("data", forward);
    }
  }

  // ── Shutdown ────────────────────────────────────────────────────────────
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logServe(`Received ${signal}, shutting down...`);
    if (timer) clearTimeout(timer);
    await Promise.allSettled(watchers.map((w) => w.close()));
    await Promise.allSettled([stopApp(), killTree(typeChecker, 1000)]);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  if (process.platform === "win32") process.on("SIGBREAK", () => void shutdown("SIGBREAK"));

  if (failures.size) reportFailures();
  else startApp();
  logWatch("Watching for changes. Press Ctrl+C to stop.");

  // Keep the promise pending for the lifetime of the server.
  await new Promise<void>(() => {});
}
