/**
 * @copyright 2024
 * @author Tareq Hossain
 * @email xtrinsic96@gmail.com
 * @url https://github.com/xtareq
 */
import { runInTransaction } from "./connection";
import { ModelQuery } from "./query";
import type { RelationDefinition } from "./relations";
import type { ModelClass, Row, UpdateInput } from "./types";

/**
 * The related rows of one model's `hasMany` / `hasOne` relation, to query or
 * create them with the foreign key filled in:
 *
 * ```ts
 * const post = await user.related("posts").create({ title: "Hello" });
 * const drafts = await user.related("posts").query().where("published", 0).get();
 * ```
 */
export class HasRelation<R, Kind extends "many" | "one" = "many"> {
  constructor(
    private readonly parent: any,
    private readonly def: RelationDefinition,
  ) {}

  private get relatedClass(): ModelClass<R> {
    return this.def.related() as unknown as ModelClass<R>;
  }

  private parentKey(): unknown {
    const key = this.parent[this.def.localKey];
    if (key === null || key === undefined) {
      throw new Error(
        `[Megh ORM] Save the ${this.parent.constructor.name} before using its related ${this.relatedClass.name} rows.`,
      );
    }
    return key;
  }

  /** A query on the related rows. */
  query(): ModelQuery<R> {
    return (new ModelQuery<R>(this.relatedClass) as ModelQuery<any>).where(
      this.def.foreignKey,
      this.parentKey(),
    );
  }

  /** The related rows (`hasMany`) or row (`hasOne`, `null` when missing). */
  async get(): Promise<Kind extends "many" ? Row<R>[] : Row<R> | null> {
    if (this.def.kind === "hasOne") {
      return ((await this.query().first()) ?? null) as any;
    }
    return (await this.query().get()) as any;
  }

  /** Insert a related row with the foreign key set to this model's key. */
  async create(values: UpdateInput<R>): Promise<Row<R>> {
    return (this.relatedClass as any).create({
      ...values,
      [this.def.foreignKey]: this.parentKey(),
    });
  }

  /** Insert several related rows in one transaction. */
  async createMany(list: readonly UpdateInput<R>[]): Promise<Row<R>[]> {
    return runInTransaction(async () => {
      const out: Row<R>[] = [];
      for (const values of list) out.push(await this.create(values));
      return out;
    });
  }

  /** Point `model` at this parent (set its foreign key) and save it. */
  async save<T extends R>(model: T): Promise<T> {
    (model as any)[this.def.foreignKey] = this.parentKey();
    return (model as any).save();
  }
}
