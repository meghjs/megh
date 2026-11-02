import type { MigrationColumn, MigrationTable } from "./migration-schema";
import { renderStub } from "../utils/stubs";

/**
 * Renders a Megh ORM model (`class X extends Model`), with its columns taken
 * from the table's migrations when there are any.
 */

const IRREGULAR: Record<string, string> = {
  person: "people",
  child: "children",
  man: "men",
  woman: "women",
  mouse: "mice",
  datum: "data",
};

/** Plural of a snake_case name, inflecting the last word: `blog_post` → `blog_posts`. */
export function pluralize(snake: string): string {
  const parts = snake.split("_");
  const last = parts.pop() ?? "";
  let plural: string;
  if (IRREGULAR[last]) plural = IRREGULAR[last];
  else if (/[^aeiou]y$/.test(last)) plural = last.slice(0, -1) + "ies";
  else if (/(s|x|z|ch|sh)$/.test(last)) plural = last + "es";
  else plural = last + "s";
  return [...parts, plural].join("_");
}

type Cast = "boolean" | "number" | "json" | "date" | "datetime";

interface FieldType {
  ts: string;
  cast?: Cast;
}

/** TypeScript type (and cast) for a column's SQL data type. */
export function fieldType(sqlType: string): FieldType {
  const base = sqlType.replace(/\(.*$/, "").trim();
  if (/^(tinyint|bool|boolean|bit)$/.test(base)) {
    // MySQL tinyint(1) and SQLite integers hold booleans as 0/1.
    if (base !== "tinyint" || /^tinyint\(1\)/.test(sqlType)) return { ts: "boolean", cast: "boolean" };
  }
  if (/^(int\d?|integer|smallint|mediumint|tinyint|bigint|serial\d?|smallserial|bigserial)$/.test(base)) {
    // Postgres returns bigint as a string; the cast turns it back into a number.
    return /big/.test(base) ? { ts: "number", cast: "number" } : { ts: "number" };
  }
  if (/^(real|float\d?|double|double precision|decimal|numeric|money)$/.test(base)) {
    return { ts: "number", cast: "number" };
  }
  if (base === "date") return { ts: "Date", cast: "date" };
  if (/^(timestamp|timestamptz|timestamp with(out)? time zone|datetime|datetime2|datetimeoffset|smalldatetime)$/.test(base)) {
    return { ts: "Date", cast: "datetime" };
  }
  if (/^(text|tinytext|mediumtext|longtext|varchar|char|character|character varying|nvarchar|nchar|ntext|uuid|citext|enum|inet|cidr|macaddr|time|timetz|time with(out)? time zone|interval)$/.test(base)) {
    return { ts: "string" };
  }
  if (/^jsonb?$/.test(base)) return { ts: "Record<string, unknown>", cast: "json" };
  if (/^(blob|bytea|binary|varbinary|longblob|mediumblob|tinyblob|image)$/.test(base)) {
    return { ts: "Buffer" };
  }
  return { ts: "unknown" };
}

const TIMESTAMPS = ["created_at", "updated_at"];

/** A model class for `table`, declaring the columns its migrations create. */
export function renderOrmModel(model: string, table: MigrationTable): string {
  const columns = table.columns;
  const has = (name: string) => columns.some((c) => c.name === name);
  const timestamps = TIMESTAMPS.every(has);
  const softDeletes = has("deleted_at");
  const implicit = new Set([...(timestamps ? TIMESTAMPS : []), ...(softDeletes ? ["deleted_at"] : [])]);

  const pk = columns.find((c) => c.primaryKey);
  const statics: string[] = [`static readonly table = ${q(table.name)};`];
  if (pk && pk.name !== "id") statics.push(`static readonly primaryKey = ${q(pk.name)};`);

  // `generated` defaults to ["id"]; spell it out when that is wrong.
  const generated = columns.filter((c) => c.generated && !implicit.has(c.name)).map((c) => c.name);
  const isDefault = generated.length === 1 && generated[0] === "id";
  if (!isDefault && (generated.length > 0 || has("id"))) {
    statics.push(`static readonly generated = [${generated.map(q).join(", ")}] as const;`);
  }
  if (timestamps) statics.push("static readonly timestamps = true;");
  if (softDeletes) statics.push("static readonly softDeletes = true;");

  const casts: string[] = [];
  const fields = columns.map((column) => {
    const { ts, cast } = fieldType(column.type);
    if (cast && !implicit.has(column.name)) casts.push(`${property(column.name)}: ${q(cast)}`);
    return `${property(column.name)}!: ${nullable(column, ts, implicit)};`;
  });
  if (casts.length > 0) {
    statics.push(`static readonly casts = {\n    ${casts.join(",\n    ")},\n  } as const;`);
  }

  return renderStub("models/orm-model.stub", {
    Model: model,
    source: table.createdIn,
    statics: statics.join("\n  "),
    fields: fields.join("\n  "),
  });
}

/** A model class for a table with no migration yet: placeholder columns. */
export function renderBlankOrmModel(model: string, table: string): string {
  return renderStub("models/orm-model-blank.stub", { Model: model, table: q(table) });
}

function nullable(column: MigrationColumn, ts: string, implicit: Set<string>): string {
  // Timestamps are always filled in, even when the column allows NULL.
  if (column.notNull || (implicit.has(column.name) && column.name !== "deleted_at")) return ts;
  return `${ts} | null`;
}

const q = (value: string) => JSON.stringify(value);

/** A property key: bare when it is a valid identifier, quoted otherwise. */
const property = (name: string) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : q(name));
