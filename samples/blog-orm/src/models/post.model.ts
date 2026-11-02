import { Model, belongsTo, belongsToMany, hasMany, type Scope } from "@meghjs/core";
import { Comment } from "./comment.model";
import { Tag } from "./tag.model";
import { User } from "./user.model";

// Columns read from the migrations (the table is created in 20261102124955_create_posts_table.ts).
export class Post extends Model {
  static readonly table = "posts";
  static readonly generated = ["id", "views"] as const;
  static readonly timestamps = true;
  static readonly softDeletes = true;
  static readonly casts = {
    published_at: "datetime",
  } as const;

  id!: number;
  user_id!: number;
  title!: string;
  body!: string;
  views!: number;
  published_at!: Date | null;
  created_at!: Date;
  updated_at!: Date;
  deleted_at!: Date | null;

  // Relations (added by hand; make:model only writes columns).
  author = belongsTo(() => User, "user_id");
  comments = hasMany(() => Comment);
  tags = belongsToMany(() => Tag).withPivot<{ tagged_at: string }>("tagged_at"); // pivot table post_tag

  get isPublished(): boolean {
    return this.published_at !== null && this.published_at !== undefined;
  }
}

/** Reusable query pieces: `Post.scope(published).scope(byAuthor, 1)`. */
export const published: Scope<Post> = (q) => q.whereNotNull("published_at");
export const drafts: Scope<Post> = (q) => q.whereNull("published_at");
export const byAuthor: Scope<Post, [number]> = (q, userId) => q.where("user_id", userId);
export const tagged: Scope<Post, [string]> = (q, tag) => q.whereHas("tags", (t) => t.where("name", tag));
