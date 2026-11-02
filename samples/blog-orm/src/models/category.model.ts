import { Model } from "@meghjs/core";

// Columns read from the migrations (the table is created in 20261102163808_create_category_table.ts).
export class Category extends Model {
  static readonly table = "category";
  static readonly timestamps = true;

  id!: number;
  name!: string;
  created_at!: Date;
  updated_at!: Date;
}
