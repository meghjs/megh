import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("post_tag")
    .addColumn("post_id", "integer", (col) => col.notNull().references("posts.id").onDelete("cascade"))
    .addColumn("tag_id", "integer", (col) => col.notNull().references("tags.id").onDelete("cascade"))
    .addColumn("tagged_at", "timestamp", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint("post_tag_pk", ["post_id", "tag_id"])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("post_tag").execute();
}
