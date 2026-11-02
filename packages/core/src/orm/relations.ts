/**
 * @copyright 2024
 * @author Tareq Hossain
 * @email xtrinsic96@gmail.com
 * @url https://github.com/xtareq
 *
 * Model relations. A relation is declared once, as a field initializer:
 *
 * ```ts
 * class User extends Model {
 *   posts = hasMany(() => Post);
 * }
 * ```
 *
 * The initializer returns a marker whose type carries the related model, and
 * the marker's runtime definition is read from a probe instance.
 */

/** Brand of a relation marker. */
export const RELATION: unique symbol = Symbol("megh.orm.relation");

type RelatedClass = abstract new () => any;

export type RelationKind = "hasMany" | "hasOne" | "belongsTo" | "belongsToMany";

/** The pivot table of a many-to-many relation. */
export interface PivotDefinition {
  table: string;
  /** Pivot column holding the related model's key. */
  relatedPivotKey: string;
  /** Key on the related table that `relatedPivotKey` matches. */
  relatedKey: string;
  /** Extra pivot columns loaded into `pivot`. */
  columns: string[];
}

/** A relation's runtime definition, with defaults resolved. */
export interface RelationDefinition {
  kind: RelationKind;
  related: () => RelatedClass;
  /**
   * hasMany/hasOne: column on the related table. belongsTo: column on this
   * table. belongsToMany: pivot column holding this model's key.
   */
  foreignKey: string;
  /**
   * hasMany/hasOne/belongsToMany: key on this table. belongsTo: key on the
   * related table.
   */
  localKey: string;
  /** belongsToMany only. */
  pivot?: PivotDefinition;
}

/** Options for {@link belongsToMany}. */
export interface BelongsToManyOptions {
  /** Pivot table. Defaults to both snake_case class names, sorted: `role_user`. */
  table?: string;
  /** Pivot column for this model's key. Defaults to `<snake_case class>_id`. */
  foreignPivotKey?: string;
  /** Pivot column for the related model's key. Defaults to `<snake_case related>_id`. */
  relatedPivotKey?: string;
  /** Key on this table. Defaults to the primary key. */
  parentKey?: string;
  /** Key on the related table. Defaults to its primary key. */
  relatedKey?: string;
}

/** The definition as declared, before defaults are filled in. */
interface DeclaredRelation {
  kind: RelationKind;
  related: () => RelatedClass;
  foreignKey?: string;
  localKey?: string;
  pivot?: BelongsToManyOptions & { columns: string[] };
}

/** One-to-many: `posts = hasMany(() => Post)`. Loads as `Post[]`. */
export interface HasMany<M> {
  readonly [RELATION]: {
    kind: "many";
    type: "hasMany";
    model: M;
    def: DeclaredRelation;
  };
}
/** One-to-one: `profile = hasOne(() => Profile)`. Loads as `Profile | null`. */
export interface HasOne<M> {
  readonly [RELATION]: {
    kind: "one";
    type: "hasOne";
    model: M;
    def: DeclaredRelation;
  };
}
/** Inverse side: `author = belongsTo(() => User, "user_id")`. Loads as `User | null`. */
export interface BelongsTo<M> {
  readonly [RELATION]: {
    kind: "one";
    type: "belongsTo";
    model: M;
    def: DeclaredRelation;
  };
}

/**
 * Many-to-many through a pivot table: `roles = belongsToMany(() => Role)`.
 * Loads as `Role[]`, each with a `pivot` object.
 */
export interface BelongsToMany<M, Pivot = {}> {
  readonly [RELATION]: {
    kind: "many";
    type: "belongsToMany";
    model: M;
    pivot: Pivot;
    def: DeclaredRelation;
  };
  /**
   * Also load these pivot columns into `pivot`:
   * `belongsToMany(() => Role).withPivot<{ granted_at: string }>("granted_at")`.
   */
  withPivot<T extends Record<string, unknown>>(
    ...columns: (keyof T & string)[]
  ): BelongsToMany<M, Pivot & T>;
}

export type AnyRelation =
  HasMany<any> | HasOne<any> | BelongsTo<any> | BelongsToMany<any, any>;

function marker(def: DeclaredRelation): any {
  const kind =
    def.kind === "hasMany" || def.kind === "belongsToMany" ? "many" : "one";
  const out: any = { [RELATION]: { kind, type: def.kind, def } };
  if (def.kind === "belongsToMany") {
    out.withPivot = (...columns: string[]) => {
      def.pivot!.columns.push(...columns);
      return out;
    };
  }
  return out;
}

/**
 * One-to-many relation.
 *
 * @param foreignKey Column on the related table. Defaults to
 *   `<snake_case owner class>_id`, e.g. `user_id` on `User`.
 * @param localKey Key on this table it matches. Defaults to the primary key.
 */
export function hasMany<C extends RelatedClass>(
  related: () => C,
  foreignKey?: string,
  localKey?: string,
): HasMany<InstanceType<C>> {
  return marker({ kind: "hasMany", related, foreignKey, localKey });
}

/** One-to-one relation. Same keys as {@link hasMany}. */
export function hasOne<C extends RelatedClass>(
  related: () => C,
  foreignKey?: string,
  localKey?: string,
): HasOne<InstanceType<C>> {
  return marker({ kind: "hasOne", related, foreignKey, localKey });
}

/**
 * Inverse of {@link hasMany} / {@link hasOne}.
 *
 * @param foreignKey Column on this table. Defaults to
 *   `<snake_case relation name>_id`, e.g. `author_id` for `author`.
 * @param ownerKey Key on the related table. Defaults to its primary key.
 */
export function belongsTo<C extends RelatedClass>(
  related: () => C,
  foreignKey?: string,
  ownerKey?: string,
): BelongsTo<InstanceType<C>> {
  return marker({ kind: "belongsTo", related, foreignKey, localKey: ownerKey });
}

/**
 * Many-to-many relation through a pivot table.
 *
 * ```ts
 * class User extends Model {
 *   roles = belongsToMany(() => Role); // pivot table role_user (user_id, role_id)
 * }
 * ```
 */
export function belongsToMany<C extends RelatedClass>(
  related: () => C,
  options: BelongsToManyOptions = {},
): BelongsToMany<InstanceType<C>> {
  return marker({
    kind: "belongsToMany",
    related,
    pivot: { ...options, columns: [] },
  });
}

export function isRelationMarker(value: unknown): boolean {
  return !!value && typeof value === "object" && RELATION in value;
}

export function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

const cache = new WeakMap<Function, Map<string, RelationDefinition>>();

/** Relations of a model class, read once from a probe instance. */
export function getRelations(
  cls: (new () => any) & { primaryKey?: string },
): Map<string, RelationDefinition> {
  let defs = cache.get(cls);
  if (defs) return defs;

  defs = new Map();
  const probe = new cls();
  for (const [name, value] of Object.entries(probe)) {
    if (!isRelationMarker(value)) continue;
    const declared: DeclaredRelation = (value as any)[RELATION].def;
    defs.set(name, resolve(cls, name, declared));
  }
  cache.set(cls, defs);
  return defs;
}

type OwnerClass = (new () => any) & { primaryKey?: string };

function resolve(
  cls: OwnerClass,
  name: string,
  declared: DeclaredRelation,
): RelationDefinition {
  const ownPk = cls.primaryKey ?? "id";
  const related = () => declared.related() as unknown as OwnerClass;
  const { kind } = declared;

  if (kind === "belongsTo") {
    return {
      kind,
      related: declared.related,
      foreignKey: declared.foreignKey ?? `${snakeCase(name)}_id`,
      // The related class may not be defined yet when this runs.
      get localKey() {
        return declared.localKey ?? related().primaryKey ?? "id";
      },
    };
  }

  if (kind === "belongsToMany") {
    const options = declared.pivot!;
    return {
      kind,
      related: declared.related,
      foreignKey: options.foreignPivotKey ?? `${snakeCase(cls.name)}_id`,
      localKey: options.parentKey ?? ownPk,
      get pivot() {
        const relatedName = snakeCase(related().name);
        return {
          table:
            options.table ??
            [snakeCase(cls.name), relatedName].sort().join("_"),
          relatedPivotKey: options.relatedPivotKey ?? `${relatedName}_id`,
          relatedKey: options.relatedKey ?? related().primaryKey ?? "id",
          columns: options.columns,
        };
      },
    };
  }

  return {
    kind,
    related: declared.related,
    foreignKey: declared.foreignKey ?? `${snakeCase(cls.name)}_id`,
    localKey: declared.localKey ?? ownPk,
  };
}

export function getRelation(
  cls: (new () => any) & { primaryKey?: string },
  name: string,
): RelationDefinition {
  const def = getRelations(cls).get(name);
  if (!def) throw new Error(`[Megh ORM] ${cls.name} has no relation "${name}"`);
  return def;
}
