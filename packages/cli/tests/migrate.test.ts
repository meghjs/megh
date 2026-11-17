import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { databasePaths, formatStatus } from "../src/commands/migrate";
import { makeMigration, migrationTimestamp } from "../src/generators/make";
import { runCli } from "../src/program";

const NOW = new Date(2026, 10, 1, 9, 30, 5); // local time

describe("make:migration", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "megh-mig-"));
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "x" }));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const read = (file: string) => fs.readFileSync(file, "utf8");

  it("names files <YYYYMMDDHHmmss>_<snake_name>.ts in src/database/migrations", () => {
    expect(migrationTimestamp(NOW)).toBe("20261101093005");
    const file = makeMigration("CreateUsersTable", { cwd: tmp, now: NOW });
    expect(path.relative(tmp, file).split(path.sep).join("/")).toBe(
      "src/database/migrations/20261101093005_create_users_table.ts",
    );
  });

  it("create_<table>_table gives a create-table migration", () => {
    const content = read(makeMigration("create_blog_posts_table", { cwd: tmp, now: NOW }));
    expect(content).toContain('import { defineMigration } from "@meghjs/core";');
    expect(content).toContain('await schema.create("blog_posts", (table) => {');
    expect(content).toContain("table.id();");
    expect(content).toContain("table.timestamps();");
    expect(content).toContain('await schema.drop("blog_posts");');
  });

  it("writes the same create-table migration for every database", () => {
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "x", dependencies: { pg: "^8" } }));
    const content = read(makeMigration("create_users_table", { cwd: tmp, now: NOW }));
    expect(content).toContain("table.id();");
    expect(content).not.toContain("kysely");
  });

  it("add_x_to_<table>_table gives an alter-table migration", () => {
    const content = read(makeMigration("add_role_to_users_table", { cwd: tmp, now: NOW }));
    expect(content).toContain('schema.table("users"');
    expect(content).not.toContain("schema.create");
  });

  it("--create / --table override the guess; other names are blank", () => {
    expect(read(makeMigration("users", { cwd: tmp, now: NOW, create: "people" }))).toContain('schema.create("people"');
    expect(read(makeMigration("add_index", { cwd: tmp, now: new Date(2026, 10, 1, 9, 31), table: "users" }))).toContain(
      'schema.table("users"',
    );
    const blank = read(makeMigration("seed_roles", { cwd: tmp, now: NOW }));
    expect(blank).toContain("export default defineMigration({");
    expect(blank).not.toMatch(/schema\.(create|table)\("/);
  });

  it("honours megh.migrations and refuses to overwrite", () => {
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "x", megh: { migrations: "db/migrations" } }));
    expect(databasePaths(tmp).migrations).toBe(path.join(tmp, "db", "migrations"));
    const file = makeMigration("create_users_table", { cwd: tmp, now: NOW });
    expect(file).toBe(path.join(tmp, "db", "migrations", "20261101093005_create_users_table.ts"));
    expect(() => makeMigration("create_users_table", { cwd: tmp, now: NOW })).toThrow(/already exists/);
  });

  it("formatStatus", () => {
    expect(formatStatus([])).toBe("No migrations found.");
    const out = formatStatus([
      { name: "1_a", executedAt: "2026-11-01T00:00:00.000Z" },
      { name: "2_b", executedAt: null },
    ]);
    expect(out).toContain("1_a");
    expect(out).toContain("2026-11-01T00:00:00.000Z");
    expect(out).toContain("pending");
  });
});

// ── End to end: compiles a project and runs migrations on SQLite ──────────
// The project lives under this package's node_modules so it resolves
// @meghjs/core (built), kysely and better-sqlite3 from the workspace.

describe("migrate commands", () => {
  let root: string;
  let out: string[];
  let err: string[];

  beforeEach(() => {
    const base = path.join(__dirname, "..", "node_modules", ".megh-test");
    fs.mkdirSync(base, { recursive: true });
    root = fs.mkdtempSync(path.join(base, "app-"));
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app" }));
    fs.mkdirSync(path.join(root, "src", "database"), { recursive: true });
    // No connection module: the CLI connects from DATABASE_URL, like app.useMeghORM().
    fs.writeFileSync(
      path.join(root, ".env"),
      `DATABASE_URL=sqlite:${path.join(root, "db.sqlite")}\nDB_FILE=${path.join(root, "db.sqlite")}\n`,
    );
    out = [];
    err = [];
    vi.spyOn(console, "log").mockImplementation((m) => void out.push(String(m)));
    vi.spyOn(console, "error").mockImplementation((m) => void err.push(String(m)));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const tables = () => {
    const Database = require("better-sqlite3");
    const db = new Database(path.join(root, "db.sqlite"), { readonly: true });
    try {
      return db
        .prepare("select name from sqlite_master where type = 'table' and name not like 'kysely_%' and name not like 'sqlite_%'")
        .all()
        .map((r: any) => r.name)
        .sort();
    } finally {
      db.close();
    }
  };

  it("migrate, migrate:status, migrate:rollback, migrate:refresh, migrate:reset", async () => {
    makeMigration("create_users_table", { cwd: root, now: new Date(2026, 0, 1) });
    makeMigration("create_posts_table", { cwd: root, now: new Date(2026, 0, 2) });

    expect(await runCli(["migrate"], { cwd: root })).toBe(0);
    expect(tables()).toEqual(["posts", "users"]);
    expect(out.join("\n")).toContain("Migrated: 20260101000000_create_users_table");
    // Compiled into .megh/, not node_modules/.cache (#119).
    expect(fs.existsSync(path.join(root, ".megh", "migrate"))).toBe(true);
    expect(fs.existsSync(path.join(root, "node_modules", ".cache", "megh"))).toBe(false);

    out.length = 0;
    expect(await runCli(["migrate"], { cwd: root })).toBe(0);
    expect(out).toContain("Nothing to migrate.");

    out.length = 0;
    expect(await runCli(["migrate:status", "--json"], { cwd: root })).toBe(0);
    const status = JSON.parse(out.join("\n"));
    expect(status.map((s: any) => [s.name, typeof s.executedAt])).toEqual([
      ["20260101000000_create_users_table", "string"],
      ["20260102000000_create_posts_table", "string"],
    ]);

    expect(await runCli(["migrate:rollback"], { cwd: root })).toBe(0);
    expect(tables()).toEqual(["users"]);

    expect(await runCli(["migrate:refresh"], { cwd: root })).toBe(0);
    expect(tables()).toEqual(["posts", "users"]);

    expect(await runCli(["migrate:rollback", "--step", "2"], { cwd: root })).toBe(0);
    expect(tables()).toEqual([]);

    await runCli(["migrate"], { cwd: root });
    expect(await runCli(["migrate:reset"], { cwd: root })).toBe(0);
    expect(tables()).toEqual([]);
  });

  it("reports a failing migration and what ran before it", async () => {
    makeMigration("create_users_table", { cwd: root, now: new Date(2026, 0, 1) });
    const bad = makeMigration("break_things", { cwd: root, now: new Date(2026, 0, 2) });
    fs.writeFileSync(bad, 'export async function up() { throw new Error("boom"); }\n');

    expect(await runCli(["migrate"], { cwd: root })).toBe(1);
    const message = err.join("\n");
    expect(message).toContain("Migration 20260102000000_break_things failed: boom");
    expect(message).toContain("20260101000000_create_users_table");
    expect(tables()).toEqual(["users"]);
  });

  it("still uses a src/database/connection.ts that exports a Kysely instance", async () => {
    fs.writeFileSync(path.join(root, ".env"), `DB_FILE=${path.join(root, "db.sqlite")}\n`);
    fs.writeFileSync(
      path.join(root, "src", "database", "connection.ts"),
      [
        'import { Kysely, SqliteDialect } from "kysely";',
        'import Database from "better-sqlite3";',
        "",
        "export default new Kysely<any>({",
        "  dialect: new SqliteDialect({ database: new Database(process.env.DB_FILE!) }),",
        "});",
      ].join("\n"),
    );
    makeMigration("create_users_table", { cwd: root, now: new Date(2026, 0, 1) });

    expect(await runCli(["migrate"], { cwd: root })).toBe(0);
    expect(tables()).toEqual(["users"]);
  });

  const writeBuiltMigration = (dir: string, name: string, table: string) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${name}.js`),
      [
        "exports.default = {",
        `  async up(db) { await db.schema.createTable("${table}").addColumn("id", "integer").execute(); },`,
        `  async down(db) { await db.schema.dropTable("${table}").execute(); },`,
        "};",
      ].join("\n"),
    );
  };

  it("runs the built migrations when there is no src/ folder (#107)", async () => {
    fs.rmSync(path.join(root, "src"), { recursive: true, force: true });
    writeBuiltMigration(path.join(root, "dist", "database", "migrations"), "20260101000000_create_users_table", "users");

    expect(await runCli(["migrate"], { cwd: root })).toBe(0);
    expect(tables()).toEqual(["users"]);
    expect(out.join("\n")).toContain("running the compiled files in dist/");
    expect(fs.existsSync(path.join(root, ".megh", "migrate"))).toBe(false);
  });

  it("--compiled reads the outDir from tsconfig, also nested under src/ (#107)", async () => {
    fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { outDir: "build" } }));
    writeBuiltMigration(path.join(root, "build", "src", "database", "migrations"), "20260101000000_create_posts_table", "posts");

    expect(await runCli(["migrate", "--compiled"], { cwd: root })).toBe(0);
    expect(tables()).toEqual(["posts"]);
  });

  it("--compiled explains a missing build (#107)", async () => {
    expect(await runCli(["migrate", "--compiled"], { cwd: root })).toBe(1);
    expect(err.join("\n")).toContain("Run megh build first");
  });

  it("takes settings from megh.database in package.json", async () => {
    fs.writeFileSync(path.join(root, ".env"), "");
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "app", megh: { database: { dialect: "sqlite", database: path.join(root, "db.sqlite") } } }),
    );
    makeMigration("create_users_table", { cwd: root, now: new Date(2026, 0, 1) });

    expect(await runCli(["migrate"], { cwd: root })).toBe(0);
    expect(tables()).toEqual(["users"]);
  });

  it("explains what to set when no database is configured", async () => {
    fs.writeFileSync(path.join(root, ".env"), "");
    expect(await runCli(["migrate"], { cwd: root })).toBe(1);
    expect(err.join("\n")).toContain("No database configured. Set DATABASE_URL");
  });

  it("explains a megh.database path that doesn't exist", async () => {
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app", megh: { database: "src/db.ts" } }));
    expect(await runCli(["migrate"], { cwd: root })).toBe(1);
    expect(err.join("\n")).toContain("No database connection module at src/db.ts");
  });
});
