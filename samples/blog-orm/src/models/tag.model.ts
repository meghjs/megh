import { Model, belongsToMany } from "@meghjs/core";
import { Post } from "./post.model";

// Columns read from the migrations (the table is created in 20261102125000_create_tags_table.ts).
export class Tag extends Model {
  static readonly table = "tags";

  id!: number;
  name!: string;

  posts = belongsToMany(() => Post);
}
