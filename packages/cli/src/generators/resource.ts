import type { MigrationColumn, MigrationTable } from "./migration-schema";
import { fieldType } from "./orm-model";
import { renderStub } from "../utils/stubs";

/**
 * What `make:resource` needs to know about a model to write its DTOs,
 * service and controller: read from the model's source, and refined with its
 * table's migration when there is one (for `varchar(n)` lengths and integer
 * vs. decimal columns).
 */

export interface ResourceField {
  name: string;
  /** TypeScript type without `| null`, e.g. `string`, `Date`. */
  ts: string;
  nullable: boolean;
  /** The database fills it in (`static generated`), so `create()` may leave it out. */
  generated: boolean;
  /** SQL type from the migration, when known. */
  sqlType?: string;
}

export interface ResourceSchema {
  /** `megh` for `extends Model`, `typeorm` for an `@Entity` class. */
  kind: "megh" | "typeorm";
  /** `static table`, if the model declares one. */
  table?: string;
  primaryKey: string;
  /** TypeScript type of the primary key. */
  primaryKeyType: string;
  /** Columns a client may send when creating or updating a row. */
  inputFields: ResourceField[];
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** The string value of `static readonly <name> = "..."`. */
function staticString(source: string, name: string): string | undefined {
  return source.match(new RegExp(`static\\s+(?:readonly\\s+)?${name}\\s*=\\s*["'\`]([^"'\`]+)["'\`]`))?.[1];
}

function staticTrue(source: string, name: string): boolean {
  return new RegExp(`static\\s+(?:readonly\\s+)?${name}\\s*=\\s*true\\b`).test(source);
}

/** `static generated = [...]` as a list, or `undefined` when not declared. */
function staticList(source: string, name: string): string[] | undefined {
  const m = source.match(new RegExp(`static\\s+(?:readonly\\s+)?${name}\\s*=\\s*\\[([^\\]]*)\\]`));
  if (!m) return undefined;
  return (m[1].match(/["'`][^"'`]+["'`]/g) ?? []).map((s) => s.slice(1, -1));
}

interface Declared {
  name: string;
  ts: string;
  nullable: boolean;
  decorators: string[];
}

/**
 * Property declarations of the model class (`name!: string;`), with the
 * decorators above each one. Initialised properties (relations such as
 * `posts = hasMany(...)`), statics and methods are skipped.
 */
function declaredProperties(source: string): Declared[] {
  const out: Declared[] = [];
  let decorators: string[] = [];
  // Bracket depth at the start of each line: properties sit directly in the
  // class body (depth 1), not inside object literals or decorator arguments.
  let depth = 0;
  for (const raw of source.split(/\r?\n/)) {
    const line = withoutLineComment(raw).trim();
    const atDepth = depth;
    depth += bracketDelta(line);
    if (atDepth !== 1) {
      // The rest of a multi-line decorator, e.g. `@Column({ nullable: true })`.
      if (decorators.length > 0) decorators[decorators.length - 1] += " " + line;
      continue;
    }
    const decorator = line.match(/^@(\w+)/);
    if (decorator) {
      decorators.push(decorator[1] + line.slice(decorator[0].length));
      continue;
    }
    const prop = line.match(/^(?:(?:public|declare|readonly)\s+)*(\w+|"[^"]+"|'[^']+')\s*([!?])?\s*:\s*([^=;]+?)\s*;?$/);
    if (prop && !/^(static|private|protected|get|set|async)\b/.test(line)) {
      const name = prop[1].replace(/^["']|["']$/g, "");
      const parts = prop[3].split("|").map((p) => p.trim());
      const nullable = prop[2] === "?" || parts.includes("null") || parts.includes("undefined");
      const ts = parts.filter((p) => p !== "null" && p !== "undefined").join(" | ") || "unknown";
      out.push({ name, ts, nullable, decorators });
    }
    if (line && !line.startsWith("//") && !line.startsWith("*") && !line.startsWith("/*")) decorators = [];
  }
  return out;
}

/** A line without its trailing `//` comment (a `//` inside a string is kept). */
function withoutLineComment(line: string): string {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = line.indexOf(ch, i + 1);
      if (end === -1) return line;
      i = end;
    } else if (ch === "/" && line[i + 1] === "/") return line.slice(0, i);
  }
  return line;
}

/** Opening minus closing brackets on a line (already without its comment), ignoring strings. */
function bracketDelta(line: string): number {
  let delta = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = line.indexOf(ch, i + 1);
      if (end === -1) break;
      i = end;
    } else if (ch === "{" || ch === "(" || ch === "[") delta++;
    else if (ch === "}" || ch === ")" || ch === "]") delta--;
  }
  return delta;
}

/** Read a model (Megh ORM or TypeORM) for resource generation. */
export function readModelSchema(source: string, table?: MigrationTable): ResourceSchema {
  const byName = new Map<string, MigrationColumn>((table?.columns ?? []).map((c) => [c.name, c]));
  const withSql = (f: ResourceField): ResourceField => {
    const column = byName.get(f.name);
    return column?.type ? { ...f, sqlType: column.type } : f;
  };

  if (/@Entity\s*\(/.test(source)) {
    const props = declaredProperties(source);
    const skip = /^(PrimaryGeneratedColumn|CreateDateColumn|UpdateDateColumn|DeleteDateColumn|VersionColumn|OneToMany|ManyToOne|OneToOne|ManyToMany|JoinColumn|JoinTable|RelationId)\b/;
    const pk = props.find((p) => p.decorators.some((d) => /^Primary(Generated)?Column\b/.test(d)));
    const columns = props.filter((p) => p.decorators.some((d) => /^(Primary)?Column\b/.test(d)));
    return {
      kind: "typeorm",
      table: source.match(/@Entity\s*\(\s*(?:\{[^}]*name\s*:\s*)?["'`]([^"'`]+)/)?.[1],
      primaryKey: pk?.name ?? "id",
      primaryKeyType: pk?.ts ?? "number",
      inputFields: columns
        .filter((p) => !p.decorators.some((d) => skip.test(d)))
        .map((p) =>
          withSql({
            name: p.name,
            ts: p.ts,
            nullable: p.nullable || p.decorators.some((d) => /nullable\s*:\s*true/.test(d)),
            generated: p.decorators.some((d) => /default\s*:/.test(d)),
          }),
        ),
    };
  }

  const primaryKey = staticString(source, "primaryKey") ?? "id";
  const generated = new Set(staticList(source, "generated") ?? ["id"]);
  const implicit = new Set<string>();
  if (staticTrue(source, "timestamps")) {
    implicit.add(staticString(source, "createdAt") ?? "created_at");
    implicit.add(staticString(source, "updatedAt") ?? "updated_at");
  }
  if (staticTrue(source, "softDeletes")) implicit.add(staticString(source, "deletedAt") ?? "deleted_at");

  const props = declaredProperties(source);
  const pk = props.find((p) => p.name === primaryKey);
  return {
    kind: "megh",
    table: staticString(source, "table"),
    primaryKey,
    primaryKeyType: pk?.ts ?? "number",
    inputFields: props
      // An auto-generated key and the timestamps are never sent by clients.
      .filter((p) => !implicit.has(p.name) && !(p.name === primaryKey && generated.has(p.name)))
      .map((p) => withSql({ name: p.name, ts: p.ts, nullable: p.nullable, generated: generated.has(p.name) })),
  };
}

const INTEGER = /^(int\d?|integer|smallint|mediumint|tinyint|bigint|serial\d?|smallserial|bigserial)$/;

/** class-validator decorators (and the type to declare) for one DTO field. */
function validators(field: ResourceField): { decorators: string[]; ts: string } {
  const sql = field.sqlType ?? "";
  const base = sql.replace(/\(.*$/, "").trim();
  const ts = field.sqlType && field.ts === "unknown" ? fieldType(sql).ts : field.ts;
  const d: string[] = [];
  switch (ts) {
    case "string": {
      if (/(^|_)email$/i.test(field.name)) d.push("IsEmail()");
      else if (base === "uuid") d.push("IsUUID()");
      else d.push("IsString()");
      const length = sql.match(/^(?:n?varchar|n?char|character varying|character)\s*\((\d+)\)/)?.[1];
      if (length) d.push(`MaxLength(${length})`);
      break;
    }
    case "number":
      d.push(INTEGER.test(base) ? "IsInt()" : "IsNumber()");
      break;
    case "boolean":
      d.push("IsBoolean()");
      break;
    case "Date":
      d.push("Type(() => Date)", "IsDate()");
      break;
    default:
      if (/^Record<|^\{/.test(ts)) d.push("IsObject()");
      // Anything else (Buffer, unknown, unions) is accepted as sent.
      else d.push("Allow()");
  }
  return { decorators: d, ts };
}

const key = (name: string) => (IDENTIFIER.test(name) ? name : JSON.stringify(name));

function renderFields(fields: ResourceField[], allOptional: boolean): string {
  return fields
    .map((f) => {
      const { decorators, ts } = validators(f);
      const optional = allOptional || f.nullable || f.generated;
      const lines = [...(optional ? ["@IsOptional()"] : []), ...decorators.map((x) => `@${x}`)];
      const type = f.nullable ? `${ts} | null` : ts;
      lines.push(`${key(f.name)}${optional ? "?" : "!"}: ${type};`);
      return lines.map((l) => `  ${l}`).join("\n");
    })
    .join("\n\n");
}

/** `src/dtos/<model>.dto.ts`: create, update and list-query DTOs. */
export function renderResourceDto(model: string, plural: string, route: string, schema: ResourceSchema): string {
  const create = renderFields(schema.inputFields, false);
  const update = renderFields(schema.inputFields, true);
  // The list query always uses these.
  const used = new Set<string>(["IsInt", "IsOptional", "Max", "Min"]);
  for (const f of schema.inputFields) {
    for (const d of validators(f).decorators) {
      const name = d.match(/^\w+/)![0];
      if (name !== "Type") used.add(name);
    }
  }
  const empty = "  // No writable columns were found on the model.";
  return renderStub("dtos/resource-dto.stub", {
    validators: [...used].sort().join(", "),
    Model: model,
    Plural: plural,
    route,
    createFields: create || empty,
    updateFields: update || empty,
  });
}
