/**
 * @copyright 2024
 * @author Tareq Hossain
 * @email xtrinsic96@gmail.com
 * @url https://github.com/xtareq
 */
import type {
  Expression,
  ExpressionBuilder,
  Kysely,
  SqlBool,
  Transaction,
} from "kysely";
import { NotFoundException } from "../common/exceptions";
import type { PageRequest, Paginated } from "../collection/pagination";
import { getConnection, runInTransaction, setConnection } from "./connection";
import type { Cast } from "./casts";
import { HasRelation } from "./has-relation";
import { PivotRelation } from "./pivot";
import {
  ModelQuery,
  assertSoftDeletes,
  type ComparisonOperator,
  type Counted,
  type CursorPageRequest,
  type CursorPaginated,
  type ModelAt,
  type RelationConstraint,
  type Scope,
  type SimplePaginated,
} from "./query";
import { RELATION, getRelation, isRelationMarker } from "./relations";
import {
  changedValues,
  columnValues,
  getState,
  hydrate,
  insertRow,
  markDeleted,
  markPersisted,
  tableOf,
  updateRow,
  withTimestamps,
} from "./state";
import type {
  BelongsToManyKeys,
  ColumnKeys,
  Columns,
  CreateInput,
  HasRelationKeys,
  ModelClass,
  PivotOf,
  PrimaryKeyValue,
  RelatedModel,
  RelationKeys,
  RelationPaths,
  Row,
  UpdateInput,
} from "./types";

type Instance<C extends ModelClass> = InstanceType<C>;

/**
 * Base class for models.
 *
 * ```ts
 * class User extends Model {
 *   static readonly table = "users";
 *
 *   id: number;
 *   email: string;
 *   name: string | null;
 *
 *   posts = hasMany(() => Post);
 * }
 *
 * const users = await User.where("email", "like", "%@acme.io").with("posts").get();
 * ```
 *
 * Every field that is not a method, a relation or a getter is a column.
 * Columns must not be `readonly`: read-only properties are treated as
 * computed values.
 *
 * Opt-in behaviour, set as static fields:
 *
 * - `timestamps = true`: fill `created_at` / `updated_at`
 * - `softDeletes = true`: `delete()` sets `deleted_at`; queries skip those rows
 * - `casts = { is_admin: "boolean", settings: "json" }`: convert stored values
 */
export abstract class Model {
  /** Table name. Required. */
  static readonly table: string;
  /** Primary key column. */
  static readonly primaryKey: string = "id";
  /**
   * Columns the database fills in, optional in `create()`. Declare a literal
   * (`["id", "created_at"] as const`) to override the default `["id"]`.
   */
  static readonly generated: readonly string[] = ["id"];

  /** Fill `createdAt` on insert and `updatedAt` on every write. */
  static readonly timestamps: boolean = false;
  static readonly createdAt: string = "created_at";
  static readonly updatedAt: string = "updated_at";

  /**
   * `delete()` sets `deletedAt` instead of removing the row, and queries
   * leave such rows out unless `withTrashed()` / `onlyTrashed()` is used.
   */
  static readonly softDeletes: boolean = false;
  static readonly deletedAt: string = "deleted_at";

  /**
   * Column casts, e.g. `{ is_admin: "boolean", settings: "json" }`.
   * Timestamp and soft-delete columns are cast as `"datetime"` already.
   */
  static readonly casts: Readonly<Record<string, Cast>> = {};

  // ── Connection ──────────────────────────────────────────────────────────

  /**
   * Set the connection models use. `app.useDatabase(kysely)` does this for
   * apps; call it directly in scripts and tests.
   */
  static useConnection(db: Kysely<any>): void {
    setConnection(db);
  }

  /**
   * The Kysely instance for raw queries: the current transaction inside
   * {@link Model.transaction}, else the root connection. Type it with
   * `DatabaseOf`: `Model.db<DatabaseOf<typeof User | typeof Post>>()`.
   */
  static db<DB = any>(): Kysely<DB> {
    return getConnection() as Kysely<DB>;
  }

  /**
   * Run `fn` in a transaction that every model query inside it uses, however
   * deep in the call chain. Commits when `fn` resolves, rolls back if it
   * throws. A nested call runs in a savepoint: if it throws, only its own
   * work is rolled back (and the error still propagates).
   */
  static transaction<T>(fn: (trx: Transaction<any>) => Promise<T>): Promise<T> {
    return runInTransaction(fn, { savepoint: true });
  }

  // ── Queries ─────────────────────────────────────────────────────────────

  static query<C extends ModelClass>(this: C): ModelQuery<Instance<C>> {
    return new ModelQuery<Instance<C>>(this);
  }

  static where<
    C extends ModelClass,
    K extends keyof Columns<Instance<C>> & string,
  >(
    this: C,
    column: K,
    value: Columns<Instance<C>>[K],
  ): ModelQuery<Instance<C>>;
  static where<
    C extends ModelClass,
    K extends keyof Columns<Instance<C>> & string,
  >(
    this: C,
    column: K,
    op: ComparisonOperator,
    value: Columns<Instance<C>>[K] | readonly Columns<Instance<C>>[K][],
  ): ModelQuery<Instance<C>>;
  static where<C extends ModelClass>(
    this: C,
    expression: (eb: ExpressionBuilder<any, any>) => Expression<SqlBool>,
  ): ModelQuery<Instance<C>>;
  static where(this: ModelClass, ...args: any[]): ModelQuery<any> {
    return (new ModelQuery<any>(this).where as any)(...args);
  }

  static with<C extends ModelClass, Q extends RelationPaths<Instance<C>>>(
    this: C,
    ...paths: Q[]
  ): ModelQuery<Instance<C>, Q> {
    return new ModelQuery<Instance<C>>(this).with(...paths);
  }

  /** Rows with at least one related row. See {@link ModelQuery.whereHas}. */
  static whereHas<C extends ModelClass, Q extends RelationPaths<Instance<C>>>(
    this: C,
    relation: Q,
    constrain?: RelationConstraint<ModelAt<Instance<C>, Q>>,
  ): ModelQuery<Instance<C>> {
    return new ModelQuery<Instance<C>>(this).whereHas(relation, constrain);
  }

  /** Rows with no related row. See {@link ModelQuery.whereDoesntHave}. */
  static whereDoesntHave<
    C extends ModelClass,
    Q extends RelationPaths<Instance<C>>,
  >(
    this: C,
    relation: Q,
    constrain?: RelationConstraint<ModelAt<Instance<C>, Q>>,
  ): ModelQuery<Instance<C>> {
    return new ModelQuery<Instance<C>>(this).whereDoesntHave(
      relation,
      constrain,
    );
  }

  /** Add `<relation>_count` to each result. See {@link ModelQuery.withCount}. */
  static withCount<C extends ModelClass, N extends RelationKeys<Instance<C>>>(
    this: C,
    ...relations: N[]
  ): ModelQuery<Instance<C>, never, ColumnKeys<Instance<C>>, Counted<N>>;
  static withCount<C extends ModelClass, N extends RelationKeys<Instance<C>>>(
    this: C,
    relation: N,
    constrain: RelationConstraint<RelatedModel<Instance<C>[N]>>,
  ): ModelQuery<Instance<C>, never, ColumnKeys<Instance<C>>, Counted<N>>;
  static withCount(this: ModelClass, ...args: any[]): any {
    return (new ModelQuery<any>(this).withCount as any)(...args);
  }

  /** Query with a reusable {@link Scope} applied. */
  static scope<C extends ModelClass, A extends unknown[]>(
    this: C,
    scope: Scope<Instance<C>, A>,
    ...args: A
  ): ModelQuery<Instance<C>> {
    return new ModelQuery<Instance<C>>(this).scope(scope, ...args);
  }

  /** Query including soft-deleted rows. */
  static withTrashed<C extends ModelClass>(this: C): ModelQuery<Instance<C>> {
    return new ModelQuery<Instance<C>>(this).withTrashed();
  }

  /** Query only soft-deleted rows. */
  static onlyTrashed<C extends ModelClass>(this: C): ModelQuery<Instance<C>> {
    return new ModelQuery<Instance<C>>(this).onlyTrashed();
  }

  static all<C extends ModelClass>(this: C): Promise<Row<Instance<C>>[]> {
    return new ModelQuery<Instance<C>>(this).get();
  }

  /** Find by primary key. */
  static find<C extends ModelClass>(
    this: C,
    id: PrimaryKeyValue<C>,
  ): Promise<Row<Instance<C>> | undefined> {
    return (new ModelQuery<Instance<C>>(this) as ModelQuery<any>)
      .where(this.primaryKey, id)
      .first();
  }

  /** Find by primary key, or throw a 404 `NotFoundException`. */
  static async findOrFail<C extends ModelClass>(
    this: C,
    id: PrimaryKeyValue<C>,
  ): Promise<Row<Instance<C>>> {
    const found = await (this as any).find(id);
    if (!found) throw new NotFoundException(`${this.name} not found`);
    return found;
  }

  /**
   * The first row matching a column value, or every given column:
   * `User.findBy("email", "ann@x.io")`, `User.findBy({ email, active: true })`.
   */
  static findBy<
    C extends ModelClass,
    K extends keyof Columns<Instance<C>> & string,
  >(
    this: C,
    column: K,
    value: Columns<Instance<C>>[K],
  ): Promise<Row<Instance<C>> | undefined>;
  static findBy<C extends ModelClass>(
    this: C,
    values: Partial<Columns<Instance<C>>>,
  ): Promise<Row<Instance<C>> | undefined>;
  static findBy(this: ModelClass, ...args: any[]): Promise<any> {
    return whereAll(this, args).first();
  }

  /** Like {@link Model.findBy}, but throws a 404 `NotFoundException` when nothing matches. */
  static findByOrFail<
    C extends ModelClass,
    K extends keyof Columns<Instance<C>> & string,
  >(
    this: C,
    column: K,
    value: Columns<Instance<C>>[K],
  ): Promise<Row<Instance<C>>>;
  static findByOrFail<C extends ModelClass>(
    this: C,
    values: Partial<Columns<Instance<C>>>,
  ): Promise<Row<Instance<C>>>;
  static findByOrFail(this: ModelClass, ...args: any[]): Promise<any> {
    return whereAll(this, args).firstOrFail();
  }

  /** Number of rows (soft-deleted rows excluded). */
  static count<C extends ModelClass>(this: C): Promise<number> {
    return new ModelQuery<Instance<C>>(this).count();
  }

  /** Sum of `column`; `0` for an empty table. */
  static sum<C extends ModelClass>(
    this: C,
    column: keyof Columns<Instance<C>> & string,
  ): Promise<number> {
    return new ModelQuery<Instance<C>>(this).sum(column);
  }

  /** Average of `column`; `null` for an empty table. */
  static avg<C extends ModelClass>(
    this: C,
    column: keyof Columns<Instance<C>> & string,
  ): Promise<number | null> {
    return new ModelQuery<Instance<C>>(this).avg(column);
  }

  /** Smallest value of `column`; `null` for an empty table. */
  static min<
    C extends ModelClass,
    K extends keyof Columns<Instance<C>> & string,
  >(this: C, column: K): Promise<Columns<Instance<C>>[K] | null> {
    return new ModelQuery<Instance<C>>(this).min(column);
  }

  /** Largest value of `column`; `null` for an empty table. */
  static max<
    C extends ModelClass,
    K extends keyof Columns<Instance<C>> & string,
  >(this: C, column: K): Promise<Columns<Instance<C>>[K] | null> {
    return new ModelQuery<Instance<C>>(this).max(column);
  }

  /** One page of every row. See {@link ModelQuery.paginate}. */
  static paginate<C extends ModelClass>(
    this: C,
    request?: PageRequest,
  ): Promise<Paginated<Row<Instance<C>>>> {
    return new ModelQuery<Instance<C>>(this).paginate(request);
  }

  /** One page without a total count. See {@link ModelQuery.simplePaginate}. */
  static simplePaginate<C extends ModelClass>(
    this: C,
    request?: PageRequest,
  ): Promise<SimplePaginated<Row<Instance<C>>>> {
    return new ModelQuery<Instance<C>>(this).simplePaginate(request);
  }

  /** Keyset pagination. See {@link ModelQuery.cursorPaginate}. */
  static cursorPaginate<C extends ModelClass>(
    this: C,
    request?: CursorPageRequest<keyof Columns<Instance<C>> & string>,
  ): Promise<CursorPaginated<Row<Instance<C>>>> {
    return new ModelQuery<Instance<C>>(this).cursorPaginate(request);
  }

  /** Insert a row and return it as a model instance. */
  static async create<C extends ModelClass>(
    this: C,
    values: CreateInput<C>,
  ): Promise<Row<Instance<C>>> {
    const row = await insertRow(this, values as Record<string, unknown>);
    return hydrate(this, row, false) as Row<Instance<C>>;
  }

  // ── Instances ───────────────────────────────────────────────────────────

  /** Whether this instance's row exists in the database. */
  isPersisted(): boolean {
    return getState(this).exists;
  }

  /** Assign column values. Call `save()` to persist them. */
  fill(values: UpdateInput<this>): this {
    Object.assign(this, values);
    return this;
  }

  /**
   * Insert the instance if it is new, otherwise update the columns that
   * changed since it was loaded (and `updated_at` with timestamps). Does
   * nothing when nothing changed.
   */
  async save(): Promise<this> {
    const cls = this.constructor as ModelClass;
    if (!getState(this).exists) {
      const row = await insertRow(cls, columnValues(this));
      Object.assign(this, row);
      markPersisted(this, row);
      return this;
    }

    const changes = changedValues(this);
    delete changes[cls.primaryKey];
    if (Object.keys(changes).length > 0) {
      const values = withTimestamps(cls, changes, "update");
      await updateRow(cls, this.key(), values);
      Object.assign(this, values);
    }
    markPersisted(this, columnValues(this));
    return this;
  }

  /** Delete the row; with `softDeletes`, set `deleted_at` instead. */
  async delete(): Promise<void> {
    const cls = this.constructor as ModelClass;
    if (!cls.softDeletes) return this.forceDelete();
    const values = withTimestamps(
      cls,
      { [cls.deletedAt]: new Date() },
      "update",
    );
    await updateRow(cls, this.key(), values);
    Object.assign(this, values);
    markPersisted(this, columnValues(this));
  }

  /** Delete the row permanently, even with `softDeletes`. */
  async forceDelete(): Promise<void> {
    const cls = this.constructor as ModelClass;
    await getConnection()
      .deleteFrom(tableOf(cls))
      .where(cls.primaryKey, "=", this.key())
      .execute();
    markDeleted(this);
  }

  /** Undo a soft delete. */
  async restore(): Promise<this> {
    const cls = this.constructor as ModelClass;
    assertSoftDeletes(cls);
    const values = withTimestamps(cls, { [cls.deletedAt]: null }, "update");
    await updateRow(cls, this.key(), values);
    Object.assign(this, values);
    markPersisted(this, columnValues(this));
    return this;
  }

  /** Whether the instance is soft-deleted. */
  isTrashed(): boolean {
    const cls = this.constructor as ModelClass;
    const value = (this as any)[cls.deletedAt];
    return cls.softDeletes && value !== null && value !== undefined;
  }

  /**
   * The pivot rows of a `belongsToMany` relation, to attach, detach or sync
   * related models: `await user.related("roles").sync([1, 2])`.
   */
  related<K extends BelongsToManyKeys<this>>(
    name: K,
  ): PivotRelation<RelatedModel<this[K]>, PivotOf<this[K]>>;
  /**
   * The rows of a `hasMany` / `hasOne` relation, to query or create them
   * with the foreign key set: `await user.related("posts").create({ title })`.
   */
  related<K extends HasRelationKeys<this>>(
    name: K,
  ): HasRelation<
    RelatedModel<this[K]>,
    this[K] extends HasManyMarker ? "many" : "one"
  >;
  related(name: string): unknown {
    const def = getRelation(this.constructor as ModelClass, name);
    if (def.kind === "belongsToMany") return new PivotRelation(this, def);
    if (def.kind === "hasMany" || def.kind === "hasOne") {
      return new HasRelation(this, def);
    }
    throw new Error(
      `[Megh ORM] related("${name}") works with hasMany, hasOne and belongsToMany relations.`,
    );
  }

  private key(): unknown {
    return (this as any)[(this.constructor as ModelClass).primaryKey];
  }

  /** Columns, loaded relations, and extras such as `pivot` and `withCount()` counts. */
  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    // Columns and relations are enumerable own properties; extras are not.
    for (const key of Object.getOwnPropertyNames(this)) {
      const value = (this as any)[key];
      if (value !== undefined && !isRelationMarker(value)) out[key] = value;
    }
    return out;
  }
}

type HasManyMarker = { readonly [RELATION]: { type: "hasMany" } };

/** A query matching `findBy(column, value)` or `findBy({ column: value })`. */
function whereAll(cls: ModelClass, args: any[]): ModelQuery<any> {
  const query = new ModelQuery<any>(cls);
  if (args.length >= 2) return query.where(args[0], args[1]);
  for (const [column, value] of Object.entries(args[0] ?? {})) {
    query.where(column, value);
  }
  return query;
}
