/**
 * @copyright 2024
 * @author Tareq Hossain
 * @email xtrinsic96@gmail.com
 * @url https://github.com/xtareq
 *
 * Type-level model description: which fields are columns, which are
 * relations, what queries return and what create() accepts.
 */
import type { Generated } from "kysely";
import type { Cast } from "./casts";
import type { AnyRelation, BelongsToMany, RELATION } from "./relations";

type Fn = (...args: any[]) => any;

type IsReadonly<T, K extends keyof T> =
  (<X>() => X extends { [Q in K]: T[K] } ? 1 : 2) extends <X>() => X extends {
    -readonly [Q in K]: T[K];
  }
    ? 1
    : 2
    ? false
    : true;

/**
 * Data columns of a model: every field except methods, relations and
 * read-only properties (getters). Key remapping keeps the column names
 * visible in error messages.
 */
export type Columns<M> = {
  [
    K in keyof M as K extends string
      ? M[K] extends Fn
        ? never
        : M[K] extends AnyRelation
          ? never
          : IsReadonly<M, K> extends true
            ? never
            : K
      : never
  ]: M[K];
};

export type ColumnKeys<M> = keyof Columns<M> & string;

type Relations<M> = {
  [
    K in keyof M as K extends string
      ? M[K] extends AnyRelation
        ? K
        : never
      : never
  ]: M[K];
};

export type RelationKeys<M> = keyof Relations<M> & string;

/** Methods and getters: kept on query results, which are model instances. */
type Members<M> = {
  [K in keyof M as K extends ColumnKeys<M> | RelationKeys<M> ? never : K]: M[K];
};

/** Keys of `belongsToMany` relations. */
export type BelongsToManyKeys<M> = keyof {
  [K in keyof M as M[K] extends BelongsToMany<any, any> ? K : never]: 0;
} &
  string;

/** Keys of `hasMany` and `hasOne` relations. */
export type HasRelationKeys<M> = keyof {
  [
    K in keyof M as M[K] extends {
      readonly [RELATION]: { type: "hasMany" | "hasOne" };
    }
      ? K
      : never
  ]: 0;
} &
  string;

export type RelatedModel<R> = R extends {
  readonly [RELATION]: { model: infer T };
}
  ? T
  : never;

/** Relation paths for `with()`, up to 3 levels: "posts" | "posts.comments" | … */
export type RelationPaths<
  M,
  Depth extends unknown[] = [],
> = Depth["length"] extends 3
  ? never
  : {
      [K in RelationKeys<M>]:
        K | `${K}.${RelationPaths<RelatedModel<M[K]>, [...Depth, unknown]>}`;
    }[RelationKeys<M>];

type Head<P> = P extends `${infer H}.${string}` ? H : P;
type Tail<P, H extends string> = P extends `${H}.${infer R}` ? R : never;

/** Pivot columns of a `belongsToMany` relation. */
export type PivotOf<R> = R extends {
  readonly [RELATION]: { pivot: infer Pivot };
}
  ? Pivot
  : never;

type Resolve<R, Shape> =
  R extends BelongsToMany<any, infer Pivot>
    ? (Shape & { readonly pivot: Pivot })[]
    : R extends { readonly [RELATION]: { kind: "many" } }
      ? Shape[]
      : Shape | null;

/** Eager-loaded relations for the path union `P`. */
type Loaded<M, P extends string> = {
  [H in Head<P> & RelationKeys<M>]: Resolve<
    M[H],
    Row<RelatedModel<M[H]>, Tail<P, H>>
  >;
};

/**
 * A query result: the selected columns `S`, the relations loaded through
 * paths `P`, and the model's methods and getters.
 */
export type Row<
  M,
  P extends string = never,
  S extends ColumnKeys<M> = ColumnKeys<M>,
> = Pick<Columns<M>, S> & Loaded<M, P> & Members<M>;

/** The static side of a model class. */
export interface ModelClass<M = any> {
  new (): M;
  readonly name: string;
  readonly table: string;
  readonly primaryKey: string;
  readonly generated: readonly string[];
  readonly timestamps: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly softDeletes: boolean;
  readonly deletedAt: string;
  readonly casts: Readonly<Record<string, Cast>>;
}

/** Columns the database fills in: `static generated` (literal), else `"id"`. */
export type GeneratedKeys<C extends ModelClass> =
  C["generated"] extends readonly (infer K)[]
    ? string extends K
      ? "id"
      : K
    : "id";

type Literal<T, Default> = string extends T ? Default : T;

/** `created_at`/`updated_at` (or their overrides) when `timestamps = true`. */
export type TimestampKeys<C extends ModelClass> = C["timestamps"] extends true
  ? | Literal<C["createdAt"], "created_at">
    | Literal<C["updatedAt"], "updated_at">
  : never;

/** Columns `create()` may leave out. */
type OptionalKeys<C extends ModelClass> =
  GeneratedKeys<C> | TimestampKeys<C> | NullableKeys<InstanceType<C>>;

type NullableKeys<M> = {
  [K in ColumnKeys<M>]: null extends M[K] ? K : never;
}[ColumnKeys<M>];

type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** `create()` input: generated, timestamp and nullable columns are optional. */
export type CreateInput<C extends ModelClass> = Simplify<
  {
    [K in Exclude<ColumnKeys<InstanceType<C>>, OptionalKeys<C>>]: Columns<
      InstanceType<C>
    >[K];
  } & {
    [K in OptionalKeys<C> & ColumnKeys<InstanceType<C>>]?: Columns<
      InstanceType<C>
    >[K];
  }
>;

/** `update()` / `fill()` input. */
export type UpdateInput<M> = Partial<Columns<M>>;

type PrimaryKey<C extends ModelClass> = string extends C["primaryKey"]
  ? "id"
  : C["primaryKey"];

/** Value type of a model's primary key. */
export type PrimaryKeyValue<C extends ModelClass> = Columns<
  InstanceType<C>
>[PrimaryKey<C> & ColumnKeys<InstanceType<C>>];

/** Kysely table interface for a model (generated and timestamp columns wrapped in `Generated`). */
export type TableOf<C extends ModelClass> = {
  [K in ColumnKeys<InstanceType<C>>]: K extends
    GeneratedKeys<C> | TimestampKeys<C>
    ? Generated<Columns<InstanceType<C>>[K]>
    : Columns<InstanceType<C>>[K];
};

/**
 * Kysely database type for raw queries, from model classes:
 * `Model.db<DatabaseOf<typeof User | typeof Post>>()`.
 */
export type DatabaseOf<C extends ModelClass> = {
  [K in C as K["table"]]: TableOf<K>;
};
