import { Model, belongsTo } from "@meghjs/core";
import { Post } from "./post.model";
import { User } from "./user.model";

// Columns read from the migrations (the table is created in 20261102124958_create_comments_table.ts).
export class Comment extends Model {
  static readonly table = "comments";
  static readonly timestamps = true;

  id!: number;
  post_id!: number;
  user_id!: number;
  body!: string;
  created_at!: Date;
  updated_at!: Date;

  post = belongsTo(() => Post);
  author = belongsTo(() => User, "user_id");
}
