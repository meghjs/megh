/**
 * @copyright 2024
 * @author Tareq Hossain
 * @email xtrinsic96@gmail.com
 * @url https://github.com/xtareq
 */
import type {
  ComparisonOperatorExpression,
  Expression,
  ExpressionBuilder,
  SqlBool,
} from "kysely";
import { BadRequestException, NotFoundException } from "../common/exceptions";
import {
  normalizePageRequest,
  paginated,
  type PageRequest,
  type Paginated,
} from "../collection/pagination";
import { bindable, castFromDatabase, castToDatabase, isSqlite } from "./casts";
import { getConnection } from "./connection";
import { getRelation, type RelationDefinition } from "./relations";
import { hydrate, tableOf, withTimestamps } from "./state";
import type {
  ColumnKeys,
  Columns,
  ModelClass,
  RelatedModel,
  RelationKeys,
  RelationPaths,
  Row,
  UpdateInput,
} from "./types";

export type ComparisonOperator = ComparisonOperatorExpression;

/** A Kysely query builder; the ORM keeps them untyped internally. */
type Builder = any;

/** What a query step needs when the SQL is built. */
interface BuildContext {
  /** Makes a value bindable for the current dialect. */
  bind: (value: unknown) => unknown;
  /** The name the query's table goes by: its table name, or an alias in a subquery. */
  ref: string;
  /** Subquery nesting depth, for unique aliases. */
  depth: number;
}

type Step = (qb: Builder, ctx: BuildContext) => Builder;

type TrashedScope = "without" | "with" | "only";

/** The model at the end of a relation path: `ModelAt<User, "posts.comments">` is `Comment`. */
export type ModelAt<M, P extends string> = P extends `${infer H}.${infer R}`
  ? ModelAt<RelatedModel<M[H & keyof M]>, R>
  : RelatedModel<M[P & keyof M]>;

/** Narrows a related query, e.g. in `whereHas("posts", q => q.where("published", 1))`. */
export type RelationConstraint<R> = (query: ModelQuery<R>) => unknown;

/**
 * A reusable query fragment, applied with `scope()`:
 *
 * ```ts
 * const published: Scope<Post> = (q) => q.whereNotNull("published_at");
 * const by: Scope<Post, [number]> = (q, userId) => q.where("user_id", userId);
 *
 * await Post.scope(published).scope(by, 1).get();
 * ```
 */
export type Scope<M, A extends unknown[] = []> = (
  query: ModelQuery<M, any, any, any>,
  ...args: A
) => unknown;

/** `withCount("posts")` adds `posts_count`. */
export type Counted<N extends string> = {
  readonly [K in N as `${K}_count`]: number;
};

interface CountRequest {
  relation: string;
  constrain?: RelationConstraint<any>;
}

/** Result of {@link ModelQuery.simplePaginate}: no total, so no `lastPage`. */
export interface SimplePaginated<T> {
  data: T[];
  meta: {
    page: number;
    perPage: number;
    hasMore: boolean;
    next: number | null;
    prev: number | null;
  };
}

/** Request for {@link ModelQuery.cursorPaginate}. */
export interface CursorPageRequest<K extends string = string> {
  /** `meta.nextCursor` from the previous page; omit for the first page. */
  cursor?: string | null;
  /** Items per page. Defaults to 10. */
  perPage?: number;
  /** Column to page by. Must be unique and sortable. Defaults to the primary key. */
  column?: K;
  direction?: "asc" | "desc";
}

/** Result of {@link ModelQuery.cursorPaginate}. */
export interface CursorPaginated<T> {
  data: T[];
  meta: {
    perPage: number;
    hasMore: boolean;
    /** Pass as `cursor` to get the next page; `null` on the last page. */
    nextCursor: string | null;
  };
}

/** Opaque cursor: the last row's value of the paging column. */
function encodeCursor(row: any, column: string): string {
  const value = row[column];
  const payload =
    value instanceof Date ? { d: value.toISOString() } : { v: value };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeCursor(cursor: string): unknown {
  try {
    const payload = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (payload && typeof payload === "object") {
      if ("d" in payload) return new Date(payload.d);
      if ("v" in payload) return payload.v;
    }
  } catch {
    // fall through
  }
  throw new BadRequestException("Invalid pagination cursor");
}

/**
 * A query on one model, e.g. `User.where("active", true).with("posts").get()`.
 * Nothing runs until `get()`, `first()`, `count()`, `paginate()`, `update()`
 * or `delete()` is called. Results are model instances.
 */
export class ModelQuery<
  M,
  P extends string = never,
  S extends ColumnKeys<M> = ColumnKeys<M>,
  /** Extra fields on each result, such as `withCount()` counts. */
  X extends object = {},
> {
  private filters: Step[] = [];
  private ordering: Step[] = [];
  private limitCount?: number;
  private offsetCount?: number;
  private eager: string[] = [];
  private selected?: string[];
  private counts: CountRequest[] = [];
  private trashed: TrashedScope = "without";

  constructor(private readonly model: ModelClass<M>) {}

  /** `where(column, value)`: equality; `null` becomes `IS NULL`. */
  where<K extends keyof Columns<M> & string>(
    column: K,
    value: Columns<M>[K],
  ): this;
  /** `where(column, op, value)`, e.g. `where("age", ">=", 18)`. */
  where<K extends keyof Columns<M> & string>(
    column: K,
    op: ComparisonOperator,
    value: Columns<M>[K] | readonly Columns<M>[K][],
  ): this;
  /**
   * `where(eb => …)`: any Kysely expression, e.g. OR groups:
   * `where(eb => eb.or([eb("role", "=", "admin"), eb("id", "=", 1)]))`.
   */
  where(
    expression: (eb: ExpressionBuilder<any, any>) => Expression<SqlBool>,
  ): this;
  where(column: unknown, opOrValue?: unknown, value?: unknown): this {
    if (typeof column === "function") {
      this.filters.push((qb) => qb.where(column));
    } else if (arguments.length === 2) {
      const op = opOrValue === null ? "is" : "=";
      this.filters.push((qb, { bind }) =>
        qb.where(column, op, bind(opOrValue)),
      );
    } else {
      this.filters.push((qb, { bind }) =>
        qb.where(
          column,
          opOrValue,
          Array.isArray(value) ? value.map(bind) : bind(value),
        ),
      );
    }
    return this;
  }

  whereIn<K extends keyof Columns<M> & string>(
    column: K,
    values: readonly Columns<M>[K][],
  ): this {
    // `IN ()` is invalid SQL; an empty list matches nothing.
    this.filters.push((qb, { bind }) =>
      values.length === 0
        ? qb.where((eb: any) => eb(eb.lit(1), "=", eb.lit(0)))
        : qb.where(column, "in", values.map(bind)),
    );
    return this;
  }

  whereNotIn<K extends keyof Columns<M> & string>(
    column: K,
    values: readonly Columns<M>[K][],
  ): this {
    if (values.length > 0) {
      this.filters.push((qb, { bind }) =>
        qb.where(column, "not in", values.map(bind)),
      );
    }
    return this;
  }

  whereNull(column: keyof Columns<M> & string): this {
    this.filters.push((qb) => qb.where(column, "is", null));
    return this;
  }

  whereNotNull(column: keyof Columns<M> & string): this {
    this.filters.push((qb) => qb.where(column, "is not", null));
    return this;
  }

  /**
   * Rows with at least one related row (matching `constrain`, if given).
   * Follows dotted paths:
   * `whereHas("posts.comments", q => q.where("body", "like", "%hi%"))`.
   * Runs as an `EXISTS` subquery.
   */
  whereHas<Q extends RelationPaths<M>>(
    relation: Q,
    constrain?: RelationConstraint<ModelAt<M, Q>>,
  ): this {
    return this.whereRelation(relation, constrain, true);
  }

  /** Rows with no related row (matching `constrain`, if given). The inverse of {@link whereHas}. */
  whereDoesntHave<Q extends RelationPaths<M>>(
    relation: Q,
    constrain?: RelationConstraint<ModelAt<M, Q>>,
  ): this {
    return this.whereRelation(relation, constrain, false);
  }

  private whereRelation(
    path: string,
    constrain: RelationConstraint<any> | undefined,
    exists: boolean,
  ): this {
    const [head, ...rest] = path.split(".");
    const def = getRelation(this.model, head);
    const inner: RelationConstraint<any> | undefined =
      rest.length > 0
        ? (q) => (q as any).whereHas(rest.join("."), constrain)
        : constrain;
    this.filters.push((qb, ctx) =>
      qb.where((eb: any) => {
        const sub = this.relationSubquery(def, inner, ctx).select(
          eb.lit(1).as("one"),
        );
        return exists ? eb.exists(sub) : eb.not(eb.exists(sub));
      }),
    );
    return this;
  }

  /**
   * Add `<relation>_count` to each result: `withCount("posts", "comments")`,
   * or one relation narrowed by a constraint:
   * `withCount("posts", q => q.where("published", 1))`.
   */
  withCount<N extends RelationKeys<M>>(
    ...relations: N[]
  ): ModelQuery<M, P, S, X & Counted<N>>;
  withCount<N extends RelationKeys<M>>(
    relation: N,
    constrain: RelationConstraint<RelatedModel<M[N]>>,
  ): ModelQuery<M, P, S, X & Counted<N>>;
  withCount(...args: any[]): any {
    const requests: CountRequest[] =
      typeof args[1] === "function"
        ? [{ relation: args[0], constrain: args[1] }]
        : args.map((relation) => ({ relation }));
    // Fail fast on unknown relations.
    for (const { relation } of requests) getRelation(this.model, relation);
    this.counts.push(...requests);
    return this;
  }

  /** Apply a reusable {@link Scope}: `Post.query().scope(byAuthor, 1)`. */
  scope<A extends unknown[]>(scope: Scope<M, A>, ...args: A): this {
    scope(this, ...args);
    return this;
  }

  orderBy(
    column: keyof Columns<M> & string,
    direction: "asc" | "desc" = "asc",
  ): this {
    this.ordering.push((qb) => qb.orderBy(column, direction));
    return this;
  }

  /** Include soft-deleted rows. */
  withTrashed(): this {
    this.trashed = "with";
    return this;
  }

  /** Only soft-deleted rows. */
  onlyTrashed(): this {
    this.trashed = "only";
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  offset(count: number): this {
    this.offsetCount = count;
    return this;
  }

  /** Only fetch these columns. The result type narrows to them. */
  select<K extends keyof Columns<M> & string>(
    ...columns: K[]
  ): ModelQuery<M, P, K, X> {
    this.selected = columns;
    return this as unknown as ModelQuery<M, P, K, X>;
  }

  /**
   * Eager-load relations, nested with dots: `with("posts.comments", "profile")`.
   * Runs one query per relation level, however many rows there are.
   */
  with<Q extends RelationPaths<M>>(...paths: Q[]): ModelQuery<M, P | Q, S, X> {
    this.eager.push(...paths);
    return this as unknown as ModelQuery<M, P | Q, S, X>;
  }

  async get(): Promise<(Row<M, P, S> & X)[]> {
    const ctx = this.context();
    let qb = this.applyFilters(
      getConnection().selectFrom(tableOf(this.model)),
      ctx,
    );
    const columns = this.selectedColumns();
    qb = columns ? qb.select(columns) : qb.selectAll();
    for (const { relation, constrain } of this.counts) {
      const def = getRelation(this.model, relation);
      qb = qb.select((eb: any) =>
        this.relationSubquery(def, constrain, ctx)
          .select(eb.fn.countAll().as("count"))
          .as(`${relation}_count`),
      );
    }
    for (const step of this.ordering) qb = step(qb, ctx);
    if (this.limitCount !== undefined) qb = qb.limit(this.limitCount);
    if (this.offsetCount !== undefined) {
      // SQLite and MySQL need a LIMIT before OFFSET.
      if (this.limitCount === undefined) qb = qb.limit(Number.MAX_SAFE_INTEGER);
      qb = qb.offset(this.offsetCount);
    }

    const rows: Record<string, unknown>[] = await qb.execute();
    const models = rows.map((row) => {
      const counts: Record<string, number> = {};
      for (const { relation } of this.counts) {
        const key = `${relation}_count`;
        // Postgres returns count(*) as a bigint string.
        counts[key] = Number(row[key] ?? 0);
        delete row[key];
      }
      const model = hydrate(this.model, row);
      for (const [key, value] of Object.entries(counts)) {
        defineExtra(model as object, key, value);
      }
      return model;
    });
    await eagerLoad(this.model, models, this.eager);
    return models as unknown as (Row<M, P, S> & X)[];
  }

  async first(): Promise<(Row<M, P, S> & X) | undefined> {
    const [row] = await this.clone().limit(1).get();
    return row;
  }

  /** Like {@link first}, but throws a 404 `NotFoundException` when nothing matches. */
  async firstOrFail(): Promise<Row<M, P, S> & X> {
    const row = await this.first();
    if (!row) throw new NotFoundException(`${this.model.name} not found`);
    return row;
  }

  async count(): Promise<number> {
    const result = await this.applyFilters(
      getConnection().selectFrom(tableOf(this.model)),
    )
      .select((eb: any) => eb.fn.countAll().as("count"))
      .executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  async exists(): Promise<boolean> {
    const probe = this.clone();
    probe.counts = [];
    probe.eager = [];
    return (await probe.select().limit(1).get()).length > 0;
  }

  /** One page of results in the unified `{ data, meta }` shape. */
  async paginate(request?: PageRequest): Promise<Paginated<Row<M, P, S> & X>> {
    const { page, perPage, offset } = normalizePageRequest(request);
    const total = await this.count();
    const data = await this.clone().limit(perPage).offset(offset).get();
    return paginated(data, total, page, perPage);
  }

  /**
   * A page of results without counting the total, for large tables or
   * "load more" lists: fetches one extra row to tell whether there is a
   * next page.
   */
  async simplePaginate(
    request?: PageRequest,
  ): Promise<SimplePaginated<Row<M, P, S> & X>> {
    const { page, perPage, offset } = normalizePageRequest(request);
    const rows = await this.clone()
      .limit(perPage + 1)
      .offset(offset)
      .get();
    const hasMore = rows.length > perPage;
    return {
      data: rows.slice(0, perPage),
      meta: {
        page,
        perPage,
        hasMore,
        next: hasMore ? page + 1 : null,
        prev: page > 1 ? page - 1 : null,
      },
    };
  }

  /**
   * Keyset ("cursor") pagination: stable under inserts and fast at any depth.
   * Orders by `column` (default: the primary key, which should be unique)
   * before any other `orderBy()`. Pass `meta.nextCursor` back as `cursor`
   * for the next page.
   *
   * ```ts
   * const first = await Post.query().cursorPaginate({ perPage: 20 });
   * const second = await Post.query().cursorPaginate({ perPage: 20, cursor: first.meta.nextCursor });
   * ```
   */
  async cursorPaginate(
    request: CursorPageRequest<keyof Columns<M> & string> = {},
  ): Promise<CursorPaginated<Row<M, P, S> & X>> {
    const { perPage } = normalizePageRequest({ perPage: request.perPage });
    const column = request.column ?? this.model.primaryKey;
    const direction = request.direction ?? "asc";
    const query = this.clone();
    if (request.cursor) {
      const after = decodeCursor(request.cursor);
      query.filters.push((qb, { bind }) =>
        qb.where(column, direction === "asc" ? ">" : "<", bind(after)),
      );
    }
    query.ordering.unshift((qb) => qb.orderBy(column, direction));
    if (query.selected && !query.selected.includes(column)) {
      query.selected.push(column);
    }
    const rows: any[] = await query
      .limit(perPage + 1)
      .offset(0)
      .get();
    const hasMore = rows.length > perPage;
    const data = rows.slice(0, perPage);
    const last = data[data.length - 1];
    return {
      data,
      meta: {
        perPage,
        hasMore,
        nextCursor: hasMore && last ? encodeCursor(last, column) : null,
      },
    };
  }

  // ── Aggregates ────────────────────────────────────────────────────────

  /** Sum of `column` over matching rows; `0` when none match. */
  async sum(column: keyof Columns<M> & string): Promise<number> {
    const value = await this.aggregate("sum", column);
    return value === null || value === undefined ? 0 : Number(value);
  }

  /** Average of `column` over matching rows; `null` when none match. */
  async avg(column: keyof Columns<M> & string): Promise<number | null> {
    const value = await this.aggregate("avg", column);
    return value === null || value === undefined ? null : Number(value);
  }

  /** Smallest value of `column` (with its cast applied); `null` when none match. */
  async min<K extends keyof Columns<M> & string>(
    column: K,
  ): Promise<Columns<M>[K] | null> {
    return this.castAggregate(column, await this.aggregate("min", column));
  }

  /** Largest value of `column` (with its cast applied); `null` when none match. */
  async max<K extends keyof Columns<M> & string>(
    column: K,
  ): Promise<Columns<M>[K] | null> {
    return this.castAggregate(column, await this.aggregate("max", column));
  }

  private async aggregate(
    fn: "sum" | "avg" | "min" | "max",
    column: string,
  ): Promise<unknown> {
    const result = await this.applyFilters(
      getConnection().selectFrom(tableOf(this.model)),
    )
      .select((eb: any) => eb.fn[fn](column).as("aggregate"))
      .executeTakeFirst();
    return result?.aggregate ?? null;
  }

  private castAggregate(column: string, value: unknown): any {
    if (value === null || value === undefined) return null;
    return castFromDatabase(this.model, { [column]: value })[column];
  }

  /**
   * Update every matching row (and `updated_at` when the model has
   * timestamps). Returns the number of rows updated.
   */
  async update(values: UpdateInput<M>): Promise<number> {
    const db = getConnection();
    const data = castToDatabase(
      this.model,
      withTimestamps(this.model, values as Record<string, unknown>, "update"),
      db,
    );
    const result = await this.applyFilters(
      db.updateTable(tableOf(this.model)).set(data),
    ).executeTakeFirst();
    return Number(result?.numUpdatedRows ?? 0);
  }

  /**
   * Delete every matching row; soft-deletes when the model has
   * `softDeletes`. Returns the number of rows affected.
   */
  async delete(): Promise<number> {
    if (this.model.softDeletes) {
      return this.update({ [this.model.deletedAt]: new Date() } as any);
    }
    return this.forceDelete();
  }

  /** Delete every matching row permanently, even with `softDeletes`. */
  async forceDelete(): Promise<number> {
    const result = await this.applyFilters(
      getConnection().deleteFrom(tableOf(this.model)),
    ).executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0);
  }

  /** Restore matching soft-deleted rows. Returns the number restored. */
  async restore(): Promise<number> {
    assertSoftDeletes(this.model);
    return this.clone()
      .withTrashed()
      .update({ [this.model.deletedAt]: null } as any);
  }

  clone(): ModelQuery<M, P, S, X> {
    const copy = new ModelQuery<M, P, S, X>(this.model);
    copy.filters = [...this.filters];
    copy.ordering = [...this.ordering];
    copy.limitCount = this.limitCount;
    copy.offsetCount = this.offsetCount;
    copy.eager = [...this.eager];
    copy.selected = this.selected && [...this.selected];
    copy.counts = [...this.counts];
    copy.trashed = this.trashed;
    return copy;
  }

  private context(): BuildContext {
    const sqlite = isSqlite(getConnection());
    return {
      bind: (value) => bindable(value, sqlite),
      ref: tableOf(this.model),
      depth: 0,
    };
  }

  private applyFilters(qb: Builder, ctx = this.context()): Builder {
    for (const step of this.filters) qb = step(qb, ctx);
    if (this.model.softDeletes && this.trashed !== "with") {
      qb = qb.where(
        this.model.deletedAt,
        this.trashed === "only" ? "is not" : "is",
        null,
      );
    }
    return qb;
  }

  /**
   * `from <related> where <related row belongs to the outer row>`, plus the
   * related query's filters (from `constrain`) and soft-delete scope. The
   * caller adds the select list. The related table is aliased, so
   * self-referencing relations work.
   */
  private relationSubquery(
    def: RelationDefinition,
    constrain: RelationConstraint<any> | undefined,
    outer: BuildContext,
  ): Builder {
    const related = def.related() as unknown as ModelClass;
    const query = new ModelQuery<any>(related);
    constrain?.(query);
    const depth = outer.depth + 1;
    const alias = `megh_r${depth}`;
    const inner: BuildContext = { bind: outer.bind, ref: alias, depth };
    const db = getConnection();

    if (def.kind === "belongsToMany") {
      const pivot = def.pivot!;
      const pivotAlias = `megh_p${depth}`;
      let qb: Builder = db
        .selectFrom(`${pivot.table} as ${pivotAlias}`)
        .whereRef(
          `${pivotAlias}.${def.foreignKey}`,
          "=",
          `${outer.ref}.${def.localKey}`,
        );
      if (query.filters.length > 0 || related.softDeletes) {
        // A separate subquery keeps unqualified columns in `constrain`
        // pointing at the related table, not the pivot.
        const keys = query.applyFilters(
          db
            .selectFrom(`${tableOf(related)} as ${alias}`)
            .select(`${alias}.${pivot.relatedKey}`),
          inner,
        );
        qb = qb.where(`${pivotAlias}.${pivot.relatedPivotKey}`, "in", keys);
      }
      return qb;
    }

    // belongsTo: outer.foreignKey → related.localKey (owner key)
    // hasMany/hasOne: outer.localKey → related.foreignKey
    const [outerKey, relatedKey] =
      def.kind === "belongsTo"
        ? [def.foreignKey, def.localKey]
        : [def.localKey, def.foreignKey];
    return query.applyFilters(
      db
        .selectFrom(`${tableOf(related)} as ${alias}`)
        .whereRef(`${alias}.${relatedKey}`, "=", `${outer.ref}.${outerKey}`),
      inner,
    );
  }

  /** Selected columns plus the keys eager loading needs, or `undefined` for all. */
  private selectedColumns(): string[] | undefined {
    if (!this.selected) return undefined;
    const columns = new Set(this.selected);
    columns.add(this.model.primaryKey);
    for (const path of this.eager) {
      const def = getRelation(this.model, path.split(".")[0]);
      columns.add(def.kind === "belongsTo" ? def.foreignKey : def.localKey);
    }
    return [...columns];
  }
}

// ---------------------------------------------------------------------------
// Eager loading
// ---------------------------------------------------------------------------

async function eagerLoad(
  cls: ModelClass,
  parents: any[],
  paths: string[],
): Promise<void> {
  if (parents.length === 0 || paths.length === 0) return;

  // ["posts.comments", "posts.author", "profile"] → posts: [comments, author], profile: []
  const tree = new Map<string, string[]>();
  for (const path of paths) {
    const [head, ...rest] = path.split(".");
    if (!tree.has(head)) tree.set(head, []);
    if (rest.length > 0) tree.get(head)!.push(rest.join("."));
  }

  for (const [name, nested] of tree) {
    const def = getRelation(cls, name);
    const related = def.related() as unknown as ModelClass;
    if (def.kind === "belongsToMany") {
      await loadBelongsToMany(def, related, parents, name, nested);
      continue;
    }
    // belongsTo: parent.foreignKey → related.localKey (owner key)
    // hasMany/hasOne: parent.localKey → related.foreignKey
    const [parentKey, relatedKey] =
      def.kind === "belongsTo"
        ? [def.foreignKey, def.localKey]
        : [def.localKey, def.foreignKey];

    const keys = [
      ...new Set(
        parents
          .map((p) => p[parentKey])
          .filter((k) => k !== null && k !== undefined),
      ),
    ];
    const children: any[] =
      keys.length === 0
        ? []
        : await (new ModelQuery<any>(related) as any)
            .whereIn(relatedKey, keys)
            .with(...nested)
            .get();

    const groups = new Map<unknown, any[]>();
    for (const child of children) {
      const key = child[relatedKey];
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(child);
    }
    for (const parent of parents) {
      const matches = groups.get(parent[parentKey]) ?? [];
      parent[name] = def.kind === "hasMany" ? matches : (matches[0] ?? null);
    }
  }
}

const PIVOT_PREFIX = "__pivot_";

/** Many-to-many: one join query through the pivot table per level. */
export async function loadBelongsToMany(
  def: RelationDefinition,
  related: ModelClass,
  parents: any[],
  name: string,
  nested: string[],
): Promise<void> {
  const pivot = def.pivot!;
  const keys = [
    ...new Set(
      parents
        .map((p) => p[def.localKey])
        .filter((k) => k !== null && k !== undefined),
    ),
  ];

  let rows: Record<string, unknown>[] = [];
  if (keys.length > 0) {
    const table = tableOf(related);
    const pivotColumns = [
      ...new Set([def.foreignKey, pivot.relatedPivotKey, ...pivot.columns]),
    ];
    let qb: Builder = getConnection()
      .selectFrom(table)
      .innerJoin(
        pivot.table,
        `${pivot.table}.${pivot.relatedPivotKey}`,
        `${table}.${pivot.relatedKey}`,
      )
      .selectAll(table)
      .select(
        pivotColumns.map((c) => `${pivot.table}.${c} as ${PIVOT_PREFIX}${c}`),
      )
      .where(`${pivot.table}.${def.foreignKey}`, "in", keys);
    if (related.softDeletes) {
      qb = qb.where(`${table}.${related.deletedAt}`, "is", null);
    }
    rows = await qb.execute();
  }

  const children = rows.map((row) => {
    const own: Record<string, unknown> = {};
    const pivotValues: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key.startsWith(PIVOT_PREFIX)) {
        pivotValues[key.slice(PIVOT_PREFIX.length)] = value;
      } else {
        own[key] = value;
      }
    }
    const child = hydrate(related, own);
    defineExtra(child as object, "pivot", pivotValues);
    return child;
  });
  await eagerLoad(related, children, nested);

  const groups = new Map<unknown, any[]>();
  for (const child of children) {
    const key = child.pivot[def.foreignKey];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(child);
  }
  for (const parent of parents) {
    parent[name] = groups.get(parent[def.localKey]) ?? [];
  }
}

/**
 * Set a computed value (pivot row, relation count) on a model instance. Not
 * enumerable, so `save()` never writes it as a column; `toJSON()` includes it.
 */
export function defineExtra(instance: object, key: string, value: unknown) {
  Object.defineProperty(instance, key, {
    value,
    enumerable: false,
    writable: true,
    configurable: true,
  });
}

export function assertSoftDeletes(cls: ModelClass) {
  if (!cls.softDeletes) {
    throw new Error(
      `[Megh ORM] ${cls.name} does not use soft deletes. Add \`static readonly softDeletes = true\`.`,
    );
  }
}
