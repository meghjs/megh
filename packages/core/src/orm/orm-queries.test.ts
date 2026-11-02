import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";
import { NotFoundException } from "../common/exceptions";
import {
  Model,
  belongsTo,
  belongsToMany,
  hasMany,
  hasOne,
  type Row,
  type Scope,
} from "./index";

// ─── Models ──────────────────────────────────────────────────────────────────

class Writer extends Model {
  static readonly table = "writers";

  id: number;
  email: string;
  active: boolean;
  manager_id: number | null;

  articles = hasMany(() => Article);
  bio = hasOne(() => Bio);
  manager = belongsTo(() => Writer, "manager_id");
  reports = hasMany(() => Writer, "manager_id");
  tags = belongsToMany(() => Tag);

  static readonly casts = { active: "boolean" } as const;
}

class Bio extends Model {
  static readonly table = "bios";

  id: number;
  writer_id: number;
  text: string;
}

class Article extends Model {
  static readonly table = "articles";
  static readonly softDeletes = true;
  static readonly casts = { published_on: "date" } as const;

  id: number;
  writer_id: number;
  title: string;
  views: number;
  published_on: Date | null;
  deleted_at: Date | null;

  writer = belongsTo(() => Writer);
  notes = hasMany(() => Note);
}

class Note extends Model {
  static readonly table = "notes";

  id: number;
  article_id: number;
  body: string;
}

class Tag extends Model {
  static readonly table = "tags";

  id: number;
  name: string;
}

// ─── Harness ─────────────────────────────────────────────────────────────────

const queries: string[] = [];
let db: Kysely<any>;

beforeAll(async () => {
  db = new Kysely<any>({
    dialect: new SqliteDialect({ database: new Database(":memory:") }),
    log: (e) => {
      if (e.level === "query") queries.push(e.query.sql.replace(/"/g, ""));
    },
  });
  for (const ddl of [
    sql`create table writers (id integer primary key autoincrement, email text not null, active integer not null default 1, manager_id integer)`,
    sql`create table bios (id integer primary key autoincrement, writer_id integer not null, text text not null)`,
    sql`create table articles (id integer primary key autoincrement, writer_id integer not null, title text not null, views integer not null default 0, published_on text, deleted_at text)`,
    sql`create table notes (id integer primary key autoincrement, article_id integer not null, body text not null)`,
    sql`create table tags (id integer primary key autoincrement, name text not null)`,
    sql`create table tag_writer (writer_id integer not null, tag_id integer not null)`,
  ]) {
    await ddl.execute(db);
  }
  Model.useConnection(db);
});

afterAll(async () => {
  await db.destroy();
});

let ann: Row<Writer>;
let bob: Row<Writer>;
let cat: Row<Writer>;

beforeEach(async () => {
  for (const table of [
    "writers",
    "bios",
    "articles",
    "notes",
    "tags",
    "tag_writer",
  ]) {
    await sql`delete from ${sql.table(table)}`.execute(db);
  }
  await sql`delete from sqlite_sequence`.execute(db);

  ann = await Writer.create({ email: "ann@x.io", active: true });
  bob = await Writer.create({
    email: "bob@x.io",
    active: true,
    manager_id: ann.id,
  });
  cat = await Writer.create({ email: "cat@x.io", active: false });
  const a1 = await Article.create({
    writer_id: ann.id,
    title: "A1",
    views: 10,
    published_on: new Date("2026-01-05"),
  });
  await Article.create({
    writer_id: ann.id,
    title: "A2",
    views: 30,
    published_on: new Date("2026-03-01"),
  });
  const b1 = await Article.create({ writer_id: bob.id, title: "B1", views: 5 });
  await b1.delete(); // soft-deleted: invisible to whereHas and counts
  await Model.db()
    .insertInto("notes")
    .values([
      { article_id: a1.id, body: "hello" },
      { article_id: a1.id, body: "world" },
    ])
    .execute();
  const [rust] = await Model.db()
    .insertInto("tags")
    .values([{ name: "rust" }, { name: "go" }])
    .returningAll()
    .execute();
  await Model.db()
    .insertInto("tag_writer")
    .values({ writer_id: cat.id, tag_id: rust.id })
    .execute();
  queries.length = 0;
});

const emails = (rows: { email: string }[]) => rows.map((r) => r.email);

// ─── whereHas / whereDoesntHave ──────────────────────────────────────────────

describe("whereHas", () => {
  it("filters by the existence of related rows, skipping soft-deleted ones", async () => {
    expect(emails(await Writer.whereHas("articles").get())).toEqual([
      "ann@x.io",
    ]);
    expect(queries[0]).toContain("exists (select 1 as one from articles as");
    expect(
      emails(await Writer.whereDoesntHave("articles").orderBy("id").get()),
    ).toEqual(["bob@x.io", "cat@x.io"]);
  });

  it("applies a constraint to the related rows", async () => {
    const rows = await Writer.query()
      .whereHas("articles", (q) => q.where("views", ">", 20))
      .get();
    expect(emails(rows)).toEqual(["ann@x.io"]);
    expect(
      await Writer.whereHas("articles", (q) =>
        q.where("views", ">", 100),
      ).count(),
    ).toBe(0);
  });

  it("follows dotted paths", async () => {
    const rows = await Writer.whereHas("articles.notes", (q) =>
      q.where("body", "world"),
    ).get();
    expect(emails(rows)).toEqual(["ann@x.io"]);
    expect(
      await Writer.whereHas("articles.notes", (q) =>
        q.where("body", "nope"),
      ).count(),
    ).toBe(0);
  });

  it("works for belongsTo, belongsToMany and self-referencing relations", async () => {
    expect(
      (
        await Article.whereHas("writer", (q) => q.where("email", "ann@x.io"))
          .orderBy("id")
          .get()
      ).map((a) => a.title),
    ).toEqual(["A1", "A2"]);
    expect(
      emails(
        await Writer.whereHas("tags", (q) => q.where("name", "rust")).get(),
      ),
    ).toEqual(["cat@x.io"]);
    expect(emails(await Writer.whereHas("tags").get())).toEqual(["cat@x.io"]);
    expect(emails(await Writer.whereHas("reports").get())).toEqual([
      "ann@x.io",
    ]);
    expect(emails(await Writer.whereHas("manager").get())).toEqual([
      "bob@x.io",
    ]);
  });

  it("composes with update() and delete()", async () => {
    expect(
      await Writer.whereDoesntHave("articles").update({ active: false }),
    ).toBe(2);
    expect(await Writer.where("active", true).count()).toBe(1);
  });

  it("rejects unknown relations at compile time", () => {
    // @ts-expect-error not a relation
    expect(() => Writer.whereHas("email")).toThrow(/no relation "email"/);
  });
});

// ─── withCount ───────────────────────────────────────────────────────────────

describe("withCount", () => {
  it("adds <relation>_count per row, without saving it as a column", async () => {
    const rows = await Writer.withCount("articles", "reports")
      .orderBy("id")
      .get();
    expect(rows.map((r) => [r.articles_count, r.reports_count])).toEqual([
      [2, 1],
      [0, 0],
      [0, 0],
    ]);
    expect(JSON.parse(JSON.stringify(rows[0]))).toMatchObject({
      email: "ann@x.io",
      articles_count: 2,
      reports_count: 1,
    });

    rows[0].email = "ann2@x.io";
    await rows[0].save(); // would fail if articles_count were written
    expect((await Writer.findOrFail(ann.id)).email).toBe("ann2@x.io");
  });

  it("takes a constraint, and works with select() and with()", async () => {
    const [row] = await Writer.query()
      .select("email")
      .withCount("articles", (q) => q.where("views", ">=", 30))
      .with("bio")
      .where("id", ann.id)
      .get();
    expect(row.articles_count).toBe(1);
    expect(row.email).toBe("ann@x.io");
  });
});

// ─── Scopes ──────────────────────────────────────────────────────────────────

describe("scopes", () => {
  const active: Scope<Writer> = (q) => q.where("active", true);
  const managedBy: Scope<Writer, [number]> = (q, id) =>
    q.where("manager_id", id);

  it("applies reusable query fragments with arguments", async () => {
    expect(emails(await Writer.scope(active).orderBy("id").get())).toEqual([
      "ann@x.io",
      "bob@x.io",
    ]);
    expect(
      emails(await Writer.query().scope(active).scope(managedBy, ann.id).get()),
    ).toEqual(["bob@x.io"]);
    // @ts-expect-error missing argument
    Writer.scope(managedBy);
  });
});

// ─── related(): hasMany / hasOne ─────────────────────────────────────────────

describe("related() on hasMany / hasOne", () => {
  it("creates rows with the foreign key filled in", async () => {
    const article = await cat.related("articles").create({ title: "C1" });
    expect(article).toBeInstanceOf(Article);
    expect(article.writer_id).toBe(cat.id);
    expect(article.isPersisted()).toBe(true);

    const many = await cat
      .related("articles")
      .createMany([{ title: "C2" }, { title: "C3" }]);
    expect(many.map((a) => a.writer_id)).toEqual([cat.id, cat.id]);
    expect(await cat.related("articles").query().count()).toBe(3);

    const bio = await cat.related("bio").create({ text: "Hi" });
    expect(bio.writer_id).toBe(cat.id);
    expect((await cat.related("bio").get())?.text).toBe("Hi");
    expect(await bob.related("bio").get()).toBeNull();
  });

  it("saves an existing model under the parent", async () => {
    const article = new Article().fill({ title: "Moved", writer_id: ann.id });
    await cat.related("articles").save(article);
    expect((await Article.findOrFail(article.id)).writer_id).toBe(cat.id);
  });

  it("lists related rows, and refuses unsaved parents and belongsTo", async () => {
    expect((await ann.related("articles").get()).map((a) => a.title)).toEqual([
      "A1",
      "A2",
    ]);
    expect(() => new Writer().related("articles").query()).toThrow(
      /Save the Writer/,
    );
    // @ts-expect-error belongsTo has no related() helper
    expect(() => bob.related("manager")).toThrow(/works with hasMany/);
  });
});

// ─── findBy ──────────────────────────────────────────────────────────────────

describe("findBy", () => {
  it("finds by a column or by several columns", async () => {
    expect((await Writer.findBy("email", "bob@x.io"))?.id).toBe(bob.id);
    expect(
      (await Writer.findBy({ active: false, email: "cat@x.io" }))?.id,
    ).toBe(cat.id);
    expect(await Writer.findBy("email", "nobody@x.io")).toBeUndefined();
    expect(
      await Writer.findBy({ manager_id: null, active: true }),
    ).toMatchObject({ id: ann.id });
    // @ts-expect-error wrong value type
    void Writer.findBy("active", "yes");
  });

  it("findByOrFail throws a 404", async () => {
    await expect(
      Writer.findByOrFail("email", "no@x.io"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((await Writer.findByOrFail({ email: "ann@x.io" })).id).toBe(ann.id);
  });

  it("respects soft deletes", async () => {
    expect(await Article.findBy("title", "B1")).toBeUndefined();
  });
});

// ─── Aggregates ──────────────────────────────────────────────────────────────

describe("aggregates", () => {
  it("computes sum, avg, min, max and count over matching rows", async () => {
    // Soft-deleted B1 (5 views) is left out.
    expect(await Article.sum("views")).toBe(40);
    expect(await Article.avg("views")).toBe(20);
    expect(await Article.min("views")).toBe(10);
    expect(await Article.max("views")).toBe(30);
    expect(await Article.count()).toBe(2);
    expect(await Article.withTrashed().sum("views")).toBe(45);
    expect(await Article.where("writer_id", ann.id).max("title")).toBe("A2");
  });

  it("applies casts to min/max", async () => {
    const latest = await Article.max("published_on");
    expect(latest).toBeInstanceOf(Date);
    expect(latest?.toISOString().slice(0, 10)).toBe("2026-03-01");
  });

  it("handles empty results", async () => {
    const none = () => Article.where("views", ">", 1000);
    expect(await none().sum("views")).toBe(0);
    expect(await none().avg("views")).toBeNull();
    expect(await none().min("views")).toBeNull();
    expect(await none().max("published_on")).toBeNull();
  });
});

// ─── Pagination ──────────────────────────────────────────────────────────────

describe("pagination", () => {
  beforeEach(async () => {
    for (let i = 1; i <= 5; i++) {
      await Writer.create({ email: `w${i}@x.io`, active: true });
    }
    // 8 writers in total
  });

  it("paginate() returns data and meta, also as a static", async () => {
    const page = await Writer.paginate({ page: 2, perPage: 3 });
    expect(page.data.map((w) => w.id)).toEqual([4, 5, 6]);
    expect(page.meta).toEqual({
      total: 8,
      page: 2,
      perPage: 3,
      lastPage: 3,
      next: 3,
      prev: 1,
    });
  });

  it("simplePaginate() skips the count query", async () => {
    const first = await Writer.simplePaginate({ perPage: 3 });
    expect(first.data).toHaveLength(3);
    expect(first.meta).toEqual({
      page: 1,
      perPage: 3,
      hasMore: true,
      next: 2,
      prev: null,
    });
    expect(queries.some((q) => q.includes("count("))).toBe(false);

    const last = await Writer.query().simplePaginate({ page: 3, perPage: 3 });
    expect(last.data.map((w) => w.id)).toEqual([7, 8]);
    expect(last.meta).toMatchObject({ hasMore: false, next: null, prev: 2 });
  });

  it("cursorPaginate() walks every row by key", async () => {
    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await Writer.where("active", true).cursorPaginate({
        perPage: 3,
        cursor,
      });
      seen.push(...page.data.map((w) => w.id));
      cursor = page.meta.nextCursor;
      pages++;
    } while (cursor);
    expect(seen).toEqual([1, 2, 4, 5, 6, 7, 8]); // cat (3) is inactive
    expect(pages).toBe(3);
  });

  it("cursorPaginate() pages by another column and direction", async () => {
    const first = await Writer.cursorPaginate({
      perPage: 2,
      column: "email",
      direction: "desc",
    });
    expect(emails(first.data)).toEqual(["w5@x.io", "w4@x.io"]);
    const second = await Writer.cursorPaginate({
      perPage: 2,
      column: "email",
      direction: "desc",
      cursor: first.meta.nextCursor,
    });
    expect(emails(second.data)).toEqual(["w3@x.io", "w2@x.io"]);
  });

  it("rejects a malformed cursor", async () => {
    await expect(
      Writer.cursorPaginate({ cursor: "not-a-cursor" }),
    ).rejects.toThrow(/Invalid pagination cursor/);
  });
});

// ─── Savepoints ──────────────────────────────────────────────────────────────

describe("nested transactions", () => {
  it("roll back only the failed savepoint", async () => {
    await Model.transaction(async () => {
      await Tag.create({ name: "kept" });
      await expect(
        Model.transaction(async () => {
          await Tag.create({ name: "dropped" });
          throw new Error("inner");
        }),
      ).rejects.toThrow("inner");
      await Model.transaction(async () => {
        await Tag.create({ name: "also kept" });
      });
    });
    const names = (await Tag.query().orderBy("id").get()).map((t) => t.name);
    expect(names).toEqual(["rust", "go", "kept", "also kept"]);
    expect(queries.some((q) => /^savepoint megh_sp_\d+$/.test(q))).toBe(true);
    expect(queries.some((q) => q.startsWith("rollback to savepoint"))).toBe(
      true,
    );
  });

  it("an outer rollback undoes released savepoints too", async () => {
    await expect(
      Model.transaction(async () => {
        await Model.transaction(async () => {
          await Tag.create({ name: "inner" });
        });
        throw new Error("outer");
      }),
    ).rejects.toThrow("outer");
    expect(await Tag.count()).toBe(2);
  });
});
