import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { runCli } from "../src/program";
import { makeModel } from "../src/generators/make";
import { readMigrationSchema } from "../src/generators/migration-schema";
import { fieldType, pluralize } from "../src/generators/orm-model";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "megh-model-"));
  fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "x" }));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const migrationsDir = () => path.join(tmp, "src", "database", "migrations");
const migration = (name: string, source: string) => {
  fs.mkdirSync(migrationsDir(), { recursive: true });
  fs.writeFileSync(path.join(migrationsDir(), name), source);
};
const read = (...p: string[]) => fs.readFileSync(path.join(tmp, ...p), "utf8");

const CREATE_USERS = `import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("users")
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    // .addColumn("ignored", "text")
    .addColumn("email", "varchar(255)", (col) => col.notNull().unique())
    .addColumn("name", "text")
    .addColumn("is_admin", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("settings", "jsonb")
    .addColumn("born_on", "date")
    .addColumn("balance", sql\`numeric(10, 2)\`, (col) => col.notNull())
    .addColumn("created_at", "timestamp", (col) => col.defaultTo(sql\`now()\`).notNull())
    .addColumn("updated_at", "timestamp")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("users").execute();
  await db.schema.createTable("users").addColumn("bogus", "text").execute();
}
`;

describe("readMigrationSchema", () => {
  it("reads create-table columns and their modifiers, ignoring down() and comments", () => {
    migration("20260101000000_create_users_table.ts", CREATE_USERS);
    const users = readMigrationSchema(migrationsDir()).get("users")!;
    expect(users.createdIn).toBe("20260101000000_create_users_table.ts");
    expect(users.columns.map((c) => c.name)).toEqual([
      "id",
      "email",
      "name",
      "is_admin",
      "settings",
      "born_on",
      "balance",
      "created_at",
      "updated_at",
    ]);
    const col = (name: string) => users.columns.find((c) => c.name === name)!;
    expect(col("id")).toMatchObject({ primaryKey: true, autoIncrement: true, generated: true, notNull: true });
    expect(col("email")).toMatchObject({ type: "varchar(255)", notNull: true, generated: false });
    expect(col("name")).toMatchObject({ notNull: false });
    expect(col("is_admin")).toMatchObject({ generated: true, autoIncrement: false });
    expect(col("balance").type).toBe("numeric(10, 2)");
  });

  it("replays later alter, rename and drop migrations", () => {
    migration("20260101000000_create_users_table.ts", CREATE_USERS);
    migration(
      "20260102000000_change_users.ts",
      `export async function up(db) {
        await db.schema.alterTable("users").addColumn("role", "text", (c) => c.notNull().defaultTo("member")).execute();
        await db.schema.alterTable("users").dropColumn("settings").renameColumn("name", "full_name").execute();
        await db.schema.alterTable("users").alterColumn("full_name", (c) => c.setNotNull()).execute();
        await db.schema.createTable("tmp").addColumn("x", "text").execute();
        await db.schema.dropTable("tmp").execute();
      }
      export async function down(db) {
        await db.schema.alterTable("users").dropColumn("email").execute();
      }`,
    );
    migration(
      "20260103000000_rename.js",
      `exports.up = async (db) => { await db.schema.alterTable('users').renameTo('members').execute(); };`,
    );
    const schema = readMigrationSchema(migrationsDir());
    expect([...schema.keys()]).toEqual(["members"]);
    const members = schema.get("members")!;
    expect(members.columns.map((c) => c.name)).toEqual([
      "id",
      "email",
      "full_name",
      "is_admin",
      "born_on",
      "balance",
      "created_at",
      "updated_at",
      "role",
    ]);
    expect(members.columns.find((c) => c.name === "full_name")!.notNull).toBe(true);
  });

  it("returns nothing for a missing folder", () => {
    expect(readMigrationSchema(path.join(tmp, "nope")).size).toBe(0);
  });
});

describe("type mapping", () => {
  it("maps SQL types to TypeScript types and casts", () => {
    expect(fieldType("integer")).toEqual({ ts: "number" });
    expect(fieldType("bigint")).toEqual({ ts: "number", cast: "number" });
    expect(fieldType("varchar(255)")).toEqual({ ts: "string" });
    expect(fieldType("uuid")).toEqual({ ts: "string" });
    expect(fieldType("boolean")).toEqual({ ts: "boolean", cast: "boolean" });
    expect(fieldType("tinyint(1)")).toEqual({ ts: "boolean", cast: "boolean" });
    expect(fieldType("tinyint")).toEqual({ ts: "number" });
    expect(fieldType("timestamptz")).toEqual({ ts: "Date", cast: "datetime" });
    expect(fieldType("date")).toEqual({ ts: "Date", cast: "date" });
    expect(fieldType("jsonb")).toEqual({ ts: "Record<string, unknown>", cast: "json" });
    expect(fieldType("bytea")).toEqual({ ts: "Buffer" });
    expect(fieldType("")).toEqual({ ts: "unknown" });
  });

  it("pluralizes table names", () => {
    expect(pluralize("user")).toBe("users");
    expect(pluralize("blog_post")).toBe("blog_posts");
    expect(pluralize("category")).toBe("categories");
    expect(pluralize("status")).toBe("statuses");
    expect(pluralize("person")).toBe("people");
  });
});

describe("make:model", () => {
  it("declares the columns of the migration that creates the table", () => {
    migration("20260101000000_create_users_table.ts", CREATE_USERS);
    makeModel("user", { cwd: tmp });
    expect(read("src", "models", "user.model.ts")).toBe(`import { Model } from "@meghjs/core";

// Columns read from the migrations (the table is created in 20260101000000_create_users_table.ts).
export class User extends Model {
  static readonly table = "users";
  static readonly generated = ["id", "is_admin"] as const;
  static readonly timestamps = true;
  static readonly casts = {
    is_admin: "boolean",
    settings: "json",
    born_on: "date",
    balance: "number",
  } as const;

  id!: number;
  email!: string;
  name!: string | null;
  is_admin!: boolean;
  settings!: Record<string, unknown> | null;
  born_on!: Date | null;
  balance!: number;
  created_at!: Date;
  updated_at!: Date;
}
`);
  });

  it("handles custom keys, soft deletes and Postgres serials", () => {
    migration(
      "20260101000000_create_blog_posts_table.ts",
      `export async function up(db) {
        await db.schema.createTable("blog_posts")
          .addColumn("uuid", "uuid", (col) => col.primaryKey())
          .addColumn("views", "bigserial")
          .addColumn("deleted_at", "timestamptz")
          .execute();
      }`,
    );
    makeModel("BlogPost", { cwd: tmp });
    const content = read("src", "models", "blog-post.model.ts");
    expect(content).toContain('static readonly primaryKey = "uuid";');
    expect(content).toContain('static readonly generated = ["views"] as const;');
    expect(content).toContain("static readonly softDeletes = true;");
    expect(content).toContain("deleted_at!: Date | null;");
    expect(content).toContain("uuid!: string;");
    expect(content).toContain("views!: number;");
    expect(content).toContain('views: "number"'); // Postgres returns bigint as text
  });

  it("uses an explicit table, or the singular name when that is what exists", () => {
    migration(
      "1_create.ts",
      `export async function up(db) {
        await db.schema.createTable("person").addColumn("id", "integer", (c) => c.primaryKey()).execute();
        await db.schema.createTable("app_accounts").addColumn("id", "integer", (c) => c.primaryKey()).execute();
      }`,
    );
    makeModel("person", { cwd: tmp });
    expect(read("src", "models", "person.model.ts")).toContain('static readonly table = "person";');
    makeModel("account", { cwd: tmp, table: "app_accounts" });
    const account = read("src", "models", "account.model.ts");
    expect(account).toContain('static readonly table = "app_accounts";');
    // A primary key without auto-increment is not generated: create() requires it.
    expect(account).toContain("static readonly generated = [] as const;");
  });

  it("falls back to a placeholder model when no migration creates the table", () => {
    makeModel("product", { cwd: tmp });
    const content = read("src", "models", "product.model.ts");
    expect(content).toContain("export class Product extends Model");
    expect(content).toContain('static readonly table = "products";');
    expect(content).toContain("id!: number;");
    expect(content).not.toMatch(/\{(Model|table|statics|fields|source)\}/);
  });

  it("keeps --orm for TypeORM entities, and works from the command line", async () => {
    makeModel("tag", { cwd: tmp, orm: true });
    expect(read("src", "models", "tag.model.ts")).toContain("@Entity");

    migration("20260101000000_create_users_table.ts", CREATE_USERS);
    expect(await runCli(["make:model", "admin/User", "-t", "users"], { cwd: tmp })).toBe(0);
    expect(read("src", "models", "admin", "user.model.ts")).toContain("email!: string;");
  });
});
