import type { Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("posts")
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("user_id", "integer", (col) => col.notNull().references("users.id").onDelete("cascade"))
    .addColumn("title", "varchar(200)", (col) => col.notNull())
    .addColumn("body", "text", (col) => col.notNull())
    .addColumn("views", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("published_at", "timestamp")
    .addColumn("created_at", "timestamp", (col) => col.notNull())
    .addColumn("updated_at", "timestamp", (col) => col.notNull())
    .addColumn("deleted_at", "timestamp")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("posts").execute();
}
