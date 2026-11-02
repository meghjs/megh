/**
 * @copyright 2024
 * @author Tareq Hossain
 * @email xtrinsic96@gmail.com
 * @url https://github.com/xtareq
 *
 * Internal: converting column values between the model and the database.
 *
 * - Casts (`static casts`) turn stored values into model values and back.
 * - Timestamp and soft-delete columns are cast as `datetime` by default.
 * - SQLite drivers only bind numbers, strings, bigints, buffers and null, so
 *   `Date` and `boolean` values are converted for SQLite.
 */
import type { Kysely } from "kysely";
import type { ModelClass } from "./types";

/** A custom cast: `get` reads from the database, `set` writes to it. */
export interface CustomCast<T = any, DB = any> {
  get?(value: DB): T;
  set?(value: T): DB;
}

/**
 * How a column's stored value maps to its model value:
 *
 * - `"boolean"`: `1`/`0`/`"true"` → `true`/`false`
 * - `"number"`: numeric strings (Postgres `bigint`/`numeric`) → numbers
 * - `"string"`
 * - `"json"`: JSON text ↔ objects
 * - `"date"`: → `Date`, written as `YYYY-MM-DD`
 * - `"datetime"`: → `Date`
 * - a {@link CustomCast}
 */
export type Cast =
  "boolean" | "number" | "string" | "json" | "date" | "datetime" | CustomCast;

/** Casts in effect for a model, including the implicit timestamp casts. */
export function castsOf(cls: ModelClass): Record<string, Cast> {
  const implicit: Record<string, Cast> = {};
  if (cls.timestamps) {
    implicit[cls.createdAt] = "datetime";
    implicit[cls.updatedAt] = "datetime";
  }
  if (cls.softDeletes) implicit[cls.deletedAt] = "datetime";
  return { ...implicit, ...cls.casts };
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return new Date(value as string | number);
}

function readValue(cast: Cast, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof cast === "object") return cast.get ? cast.get(value) : value;
  switch (cast) {
    case "boolean":
      if (typeof value === "boolean") return value;
      if (typeof value === "string")
        return value === "1" || value.toLowerCase() === "true";
      return Number(value) !== 0;
    case "number":
      return Number(value);
    case "string":
      return String(value);
    case "json":
      return typeof value === "string" ? JSON.parse(value) : value;
    case "date":
    case "datetime":
      return toDate(value);
  }
}

function writeValue(cast: Cast, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof cast === "object") return cast.set ? cast.set(value) : value;
  switch (cast) {
    case "json":
      return JSON.stringify(value);
    case "date":
      // A Date bound to a DATE column can shift a day across time zones.
      return toDate(value).toISOString().slice(0, 10);
    case "datetime":
      return toDate(value);
    default:
      return value;
  }
}

/** A row as read from the database, with casts applied. */
export function castFromDatabase(
  cls: ModelClass,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const casts = castsOf(cls);
  const out: Record<string, unknown> = { ...row };
  for (const [column, cast] of Object.entries(casts)) {
    if (column in out) out[column] = readValue(cast, out[column]);
  }
  return out;
}

/** True when `db` uses the Kysely adapter class `name` (or a subclass of it). */
export function usesAdapter(db: Kysely<any>, name: string): boolean {
  let proto = Object.getPrototypeOf(db.getExecutor().adapter);
  while (proto && proto !== Object.prototype) {
    if (proto.constructor?.name === name) return true;
    proto = Object.getPrototypeOf(proto);
  }
  return false;
}

/** True when `db` uses Kysely's SQLite adapter (or a subclass of it). */
export function isSqlite(db: Kysely<any>): boolean {
  return usesAdapter(db, "SqliteAdapter");
}

/** A value the driver can bind: `Date`/`boolean` become text/0-1 on SQLite. */
export function bindable(value: unknown, sqlite: boolean): unknown {
  if (!sqlite) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

/** Values to write, with casts applied and made bindable for the dialect. */
export function castToDatabase(
  cls: ModelClass,
  values: Record<string, unknown>,
  db: Kysely<any>,
): Record<string, unknown> {
  const casts = castsOf(cls);
  const sqlite = isSqlite(db);
  const out: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const cast = casts[column];
    out[column] = bindable(cast ? writeValue(cast, value) : value, sqlite);
  }
  return out;
}

/** Equality for change detection: by time for dates, by JSON for objects. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date)
    return a.getTime() === b.getTime();
  if (a && b && typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}
