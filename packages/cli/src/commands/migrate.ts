import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { SwcCompiler } from "../compiler";
import { CliError } from "../errors";
import { projectLayout } from "../utils/entry";
import { c, log } from "../utils/log";
import { readPackageJson, requireProjectRoot } from "../utils/project";

/** Where apps used to export their own Kysely instance. Still used when present. */
export const LEGACY_CONNECTION = "src/database/connection.ts";
export const DEFAULT_MIGRATIONS = "src/database/migrations";
export const DEFAULT_SEEDERS = "src/database/seeders";
export const DEFAULT_FACTORIES = "src/database/factories";

export type DatabasePaths = {
  /**
   * A module exporting the app's own Kysely instance (`default` or `db`),
   * from before `useMeghORM`. `null` when the connection comes from settings.
   */
  connection: string | null;
  /**
   * Connection settings from `megh.database` in package.json, merged over
   * the environment (DATABASE_URL, DB_*) the way `app.useMeghORM()` does.
   */
  settings: Record<string, unknown>;
  /** Folder of migration files. */
  migrations: string;
  /** Folder of seeder files. */
  seeders: string;
  /** Folder of model factory files. */
  factories: string;
};

/** `megh.database` / `megh.migrations` / `megh.seeders` from package.json, else the defaults. */
export function databasePaths(root: string, pkg: Record<string, any> = readPackageJson(root)): DatabasePaths {
  const conf = pkg?.megh ?? {};
  const legacy = path.resolve(root, LEGACY_CONNECTION);
  let connection: string | null = null;
  if (typeof conf.database === "string") connection = path.resolve(root, conf.database);
  else if (!conf.database && fs.existsSync(legacy)) connection = legacy;
  return {
    connection,
    settings: conf.database && typeof conf.database === "object" ? conf.database : {},
    migrations: path.resolve(root, typeof conf.migrations === "string" ? conf.migrations : DEFAULT_MIGRATIONS),
    seeders: path.resolve(root, typeof conf.seeders === "string" ? conf.seeders : DEFAULT_SEEDERS),
    factories: path.resolve(root, typeof conf.factories === "string" ? conf.factories : DEFAULT_FACTORIES),
  };
}

export type MigrateAction = "latest" | "rollback" | "reset" | "refresh" | "status" | "seed";
export type MigrateOptions = {
  cwd?: string;
  step?: number;
  /**
   * Run the compiled `.js` files from the tsconfig `outDir` (what `megh build`
   * produced) instead of compiling `src/` with SWC. Turned on automatically
   * when the source folder doesn't exist but the output does.
   */
  compiled?: boolean;
};

const MARKER = "__MEGH_MIGRATE__";

/**
 * Runs in a child process: loads `.env` and @meghjs/core from the project,
 * connects from the settings (or loads a legacy connection module), runs
 * the action, prints the result as JSON after MARKER and closes the
 * connection.
 */
const WORKER = `
const fs = require("fs");
const path = require("path");
const [root, connection, settings, folder, seedersFolder, action, args] = JSON.parse(process.argv[process.argv.length - 1]);
const send = (value) => console.log(${JSON.stringify(MARKER)} + JSON.stringify(value));
(async () => {
  let db;
  try {
    const env = path.join(root, ".env");
    if (fs.existsSync(env) && typeof process.loadEnvFile === "function") process.loadEnvFile(env);
    let core;
    try { core = require(require.resolve("@meghjs/core", { paths: [root] })); }
    catch { throw new Error("@meghjs/core is not installed in this project."); }
    if (typeof core.Migrations !== "function") throw new Error("This @meghjs/core version has no migrations; upgrade it.");
    if (connection) {
      const mod = require(connection);
      db = mod && (mod.default || mod.db);
      if (!db || typeof db.schema !== "object" || typeof db.destroy !== "function") {
        throw new Error("The connection module must export a Kysely instance as its default export or as \`db\`.");
      }
    } else {
      if (typeof core.createDatabase !== "function") {
        throw new Error("This @meghjs/core version can't connect from DATABASE_URL; upgrade it, or export a Kysely instance from src/database/connection.ts.");
      }
      db = core.createDatabase(core.resolveDatabaseOptions(settings));
    }
    if (action === "seed") {
      const [name, force] = args;
      if (typeof core.Seeders !== "function") throw new Error("This @meghjs/core version has no seeders; upgrade it.");
      if (process.env.NODE_ENV === "production" && !force) {
        throw new Error("NODE_ENV is production. Pass --force to seed anyway.");
      }
      // Models in the seeders use the ORM connection.
      if (core.Model && typeof core.Model.useConnection === "function") core.Model.useConnection(db);
      const seeders = new core.Seeders(db, { folder: seedersFolder });
      send({ ok: true, result: await seeders.run(name || undefined) });
      return;
    }
    const migrations = new core.Migrations(db, { folder });
    send({ ok: true, result: await migrations[action](...args) });
  } catch (e) {
    send({ ok: false, error: (e && e.message) || String(e), completed: (e && e.completed) || [] });
  } finally {
    if (db) await db.destroy().catch(() => {});
    process.exit(0);
  }
})();
`;

const relTo = (root: string, p: string) => path.relative(root, p).split(path.sep).join("/");
const isInside = (dir: string, file: string) => {
  const r = path.relative(dir, file);
  return !r.startsWith("..") && !path.isAbsolute(r);
};

/**
 * Paths of the built app, for production images that have `dist/` but no
 * `src/`. A path under the source folder is mapped into `outDir` (`.ts` →
 * `.js`), also trying the nested `outDir/src/...` tsc writes when `rootDir`
 * isn't set. Other paths are used as they are.
 */
export function builtPaths(root: string) {
  const layout = projectLayout(root, true);
  const paths = databasePaths(root);
  const rel = (p: string) => relTo(root, p);
  if (!fs.existsSync(layout.outDir)) {
    throw new CliError(
      `--compiled runs the built app, but ${rel(layout.outDir)}/ doesn't exist. Run megh build first.`,
    );
  }
  const explicitRootDir = typeof layout.compilerOptions.rootDir === "string";
  const map = (p: string, isFile: boolean) => {
    if (!isInside(layout.srcDir, p)) return p;
    const sub = path.relative(layout.srcDir, p);
    const js = isFile ? sub.replace(/\.[cm]?ts$/, ".js") : sub;
    const flat = path.join(layout.outDir, js);
    const nested = path.join(layout.outDir, path.relative(root, layout.srcDir), js);
    return !explicitRootDir && !fs.existsSync(flat) && fs.existsSync(nested) ? nested : flat;
  };
  const connection = paths.connection ? map(paths.connection, true) : null;
  if (connection && !fs.existsSync(connection)) {
    throw new CliError(`No compiled database connection module at ${rel(connection)}. Run megh build first.`);
  }
  const migrations = map(paths.migrations, false);
  if (!fs.existsSync(migrations)) {
    throw new CliError(`No compiled migrations at ${rel(migrations)}. Run megh build first.`);
  }
  return { connection, settings: paths.settings, migrations, seeders: map(paths.seeders, false) };
}

/** Use the built app: asked for, or there are no sources to compile. */
function useBuilt(root: string, opts: MigrateOptions): boolean {
  if (opts.compiled) return true;
  if (opts.compiled === false) return false;
  const layout = projectLayout(root, true);
  if (fs.existsSync(layout.srcDir) || !fs.existsSync(layout.outDir)) return false;
  log.info(`No ${relTo(root, layout.srcDir)}/ folder: running the compiled files in ${relTo(root, layout.outDir)}/.`);
  return true;
}

function compiled(root: string) {
  const layout = projectLayout(root);
  const paths = databasePaths(root);
  const rel = (p: string) => relTo(root, p);
  if (paths.connection && !fs.existsSync(paths.connection)) {
    throw new CliError(
      `No database connection module at ${rel(paths.connection)}.\n` +
        'Remove "megh.database" from package.json to connect from DATABASE_URL, as app.useMeghORM() does.',
    );
  }

  const cacheDir = path.join(root, "node_modules", ".cache", "megh", "migrate");
  fs.rmSync(cacheDir, { recursive: true, force: true });
  const inside = isInside;

  const app = new SwcCompiler(layout.srcDir, path.join(cacheDir, "app"), layout.compilerOptions);
  const failures = app.compileAll();
  // Migrations outside the source folder are compiled on their own.
  const migrationsCompiler = inside(layout.srcDir, paths.migrations)
    ? app
    : new SwcCompiler(paths.migrations, path.join(cacheDir, "migrations"), layout.compilerOptions);
  if (migrationsCompiler !== app) {
    for (const [file, error] of migrationsCompiler.compileAll()) failures.set(file, error);
  }
  // Seeders likewise; a missing folder just has no seeders.
  const seedersCompiler = inside(layout.srcDir, paths.seeders)
    ? app
    : new SwcCompiler(paths.seeders, path.join(cacheDir, "seeders"), layout.compilerOptions);
  if (seedersCompiler !== app && fs.existsSync(paths.seeders)) {
    for (const [file, error] of seedersCompiler.compileAll()) failures.set(file, error);
  }
  if (failures.size) {
    const list = [...failures].map(([f, e]) => `${rel(f)}: ${e.split("\n")[0]}`).join("\n  ");
    throw new CliError(`Compilation failed:\n  ${list}`);
  }

  if (paths.connection && !inside(layout.srcDir, paths.connection)) {
    throw new CliError(`The connection module ${rel(paths.connection)} must be inside ${rel(layout.srcDir)}/.`);
  }
  return {
    connection: paths.connection ? app.outFileFor(paths.connection) : null,
    settings: paths.settings,
    // outFileFor maps a file; map a placeholder inside the folder and take its directory.
    migrations: path.dirname(migrationsCompiler.outFileFor(path.join(paths.migrations, "x.ts"))),
    seeders: path.dirname(seedersCompiler.outFileFor(path.join(paths.seeders, "x.ts"))),
  };
}

/** Run a migration action in a child process and return its result. */
export function runMigrations(action: MigrateAction, opts: MigrateOptions & SeedOptions = {}): any {
  const root = requireProjectRoot(opts.cwd ?? process.cwd());
  const files = useBuilt(root, opts) ? builtPaths(root) : compiled(root);
  const args =
    action === "rollback" ? [opts.step ?? 1] : action === "seed" ? [opts.seeder ?? null, opts.force === true] : [];
  const result = spawnSync(
    process.execPath,
    ["-e", WORKER, JSON.stringify([root, files.connection, files.settings, files.migrations, files.seeders, action, args])],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? "development" },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  // Anything the app logs while loading is passed through.
  const lines = (result.stdout ?? "").split(/\r?\n/);
  const line = lines.find((l) => l.startsWith(MARKER));
  for (const l of lines) if (l && !l.startsWith(MARKER)) console.log(l);
  if (!line) {
    throw new CliError(`Could not run migrations:\n${result.stderr || result.stdout || result.error?.message}`);
  }
  const out = JSON.parse(line.slice(MARKER.length));
  if (!out.ok) {
    const done = out.completed.length ? `\nCompleted before the failure:\n  ${out.completed.join("\n  ")}` : "";
    // A seed runs in one transaction: a failure saves nothing.
    const rolledBack = action === "seed" && /^Seeder /.test(out.error) ? "\nNothing was saved." : "";
    throw new CliError(`${out.error}${done}${rolledBack}`);
  }
  return out.result;
}

function list(names: string[], verb: string, empty: string) {
  if (names.length === 0) {
    log.info(empty);
    return;
  }
  for (const name of names) log.success(`${verb} ${name}`);
}

export type SeedOptions = {
  /** Run this seeder instead of the `database` seeder (or all of them). */
  seeder?: string;
  /** Seed even when NODE_ENV is production. */
  force?: boolean;
};

/** Run the seeders: `seeder`, else the `database` seeder, else all in file order. */
export function dbSeed(opts: MigrateOptions & SeedOptions = {}): string[] {
  const names: string[] = runMigrations("seed", opts);
  list(names, "Seeded:", "Nothing to seed: there are no seeders. Create one with: megh make:seeder <name>");
  return names;
}

export function migrate(opts: MigrateOptions & SeedOptions & { seed?: boolean } = {}): string[] {
  const names: string[] = runMigrations("latest", opts);
  list(names, "Migrated:", "Nothing to migrate.");
  if (opts.seed) dbSeed(opts);
  return names;
}

export function migrateRollback(opts: MigrateOptions = {}): string[] {
  const names: string[] = runMigrations("rollback", opts);
  list(names, "Rolled back:", "Nothing to roll back.");
  return names;
}

export function migrateReset(opts: MigrateOptions = {}): string[] {
  const names: string[] = runMigrations("reset", opts);
  list(names, "Rolled back:", "Nothing to roll back.");
  return names;
}

export function migrateRefresh(
  opts: MigrateOptions & SeedOptions & { seed?: boolean } = {},
): { down: string[]; up: string[] } {
  const result: { down: string[]; up: string[] } = runMigrations("refresh", opts);
  list(result.down, "Rolled back:", "Nothing to roll back.");
  list(result.up, "Migrated:", "Nothing to migrate.");
  if (opts.seed) dbSeed(opts);
  return result;
}

export type MigrationStatusRow = { name: string; executedAt: string | null };

export function formatStatus(rows: MigrationStatusRow[]): string {
  if (rows.length === 0) return "No migrations found.";
  const width = Math.max("MIGRATION".length, ...rows.map((r) => r.name.length));
  const head = c.bold(`${"RAN".padEnd(5)}${"MIGRATION".padEnd(width + 2)}EXECUTED AT`);
  // Pad before coloring: color codes would count towards the width.
  const body = rows.map(
    (r) =>
      (r.executedAt ? c.green("✔".padEnd(5)) : c.yellow("·".padEnd(5))) +
      r.name.padEnd(width + 2) +
      (r.executedAt ? new Date(r.executedAt).toISOString() : c.dim("pending")),
  );
  return [head, ...body].join("\n");
}

export function migrateStatus(opts: MigrateOptions & { json?: boolean } = {}): MigrationStatusRow[] {
  const rows: MigrationStatusRow[] = runMigrations("status", opts);
  console.log(opts.json ? JSON.stringify(rows, null, 2) : formatStatus(rows));
  return rows;
}
