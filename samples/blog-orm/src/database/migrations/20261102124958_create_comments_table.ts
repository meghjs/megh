import type { Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("comments")
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("post_id", "integer", (col) => col.notNull().references("posts.id").onDelete("cascade"))
    .addColumn("user_id", "integer", (col) => col.notNull().references("users.id").onDelete("cascade"))
    .addColumn("body", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamp", (col) => col.notNull())
    .addColumn("updated_at", "timestamp", (col) => col.notNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("comments").execute();
}
