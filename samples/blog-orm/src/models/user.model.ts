import { Model, hasMany } from "@meghjs/core";
import { Comment } from "./comment.model";
import { Post } from "./post.model";

// Columns read from the migrations (the table is created in 20261102124953_create_users_table.ts).
export class User extends Model {
  static readonly table = "users";
  static readonly generated = ["id", "is_admin"] as const;
  static readonly timestamps = true;
  static readonly casts = {
    is_admin: "boolean",
  } as const;

  id!: number;
  name!: string;
  email!: string;
  bio!: string | null;
  is_admin!: boolean;
  created_at!: Date;
  updated_at!: Date;

  // Relations (added by hand; make:model only writes columns).
  posts = hasMany(() => Post); // posts.user_id → users.id
  comments = hasMany(() => Comment);
}
