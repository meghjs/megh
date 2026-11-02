import fs from "fs";
import path from "path";

/**
 * Reads table schemas out of Kysely migration files, without running them:
 * the `up()` code of every migration is scanned, in file order, for
 * `createTable` / `alterTable` / `dropTable` chains, and their column calls
 * are replayed. Used by `make:model` to declare a model's columns.
 *
 * It understands the schema-builder calls `make:migration` generates and
 * Kysely's documentation shows; anything it cannot read (raw SQL, computed
 * names) is skipped.
 */

export interface MigrationColumn {
  name: string;
  /** Data type as written, lower-cased, e.g. `"varchar(255)"`; `""` when not a literal. */
  type: string;
  notNull: boolean;
  primaryKey: boolean;
  /** The database fills it in: auto-increment, identity, serial or a default. */
  generated: boolean;
  /** Auto-increment / identity / serial (as opposed to a default value). */
  autoIncrement: boolean;
}

export interface MigrationTable {
  name: string;
  columns: MigrationColumn[];
  /** Migration that created the table (file name). */
  createdIn: string;
}

const EXTENSIONS = /\.(c?js|mjs|c?ts|mts)$/;
const DECLARATION = /\.d\.[cm]?ts$/;

/** Every table the migrations in `folder` leave behind, keyed by name. */
export function readMigrationSchema(folder: string): Map<string, MigrationTable> {
  const tables = new Map<string, MigrationTable>();
  if (!fs.existsSync(folder)) return tables;
  const files = fs
    .readdirSync(folder)
    .filter((f) => EXTENSIONS.test(f) && !DECLARATION.test(f))
    .sort();
  for (const file of files) {
    applyMigration(tables, upSource(fs.readFileSync(path.join(folder, file), "utf8")), file);
  }
  return tables;
}

/** The `up()` part of a migration: everything before `down`. */
function upSource(source: string): string {
  const code = stripComments(source);
  const down = code.search(/\b(?:function\s+down\b|down\s*[:=(])/);
  return down === -1 ? code : code.slice(0, down);
}

/** Drop `//` and `/* *\/` comments, keeping string contents intact. */
function stripComments(source: string): string {
  let out = "";
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipString(source, i);
      out += source.slice(i, end + 1);
      i = end;
    } else if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 1;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Index of the closing quote of the string starting at `start`. */
function skipString(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === quote) return i;
  }
  return text.length - 1;
}

/** The text between the `(` at `open` and its matching `)`, and the index after it. */
function readCall(text: string, open: number): { inner: string; end: number } {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") i = skipString(text, i);
    else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 };
    }
  }
  return { inner: text.slice(open + 1), end: text.length };
}

/** Split call arguments on top-level commas. */
function splitArgs(inner: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '"' || ch === "'" || ch === "`") i = skipString(inner, i);
    else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      args.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = inner.slice(start).trim();
  if (last) args.push(last);
  return args;
}

/** The value of a plain string literal (no `${}`), else `undefined`. */
function literal(arg: string | undefined): string | undefined {
  const m = arg?.match(/^(["'`])((?:\\.|(?!\1).)*)\1$/s);
  if (!m || (m[1] === "`" && m[2].includes("${"))) return undefined;
  return m[2];
}

/** A column data type argument: `"text"`, `sql\`varchar(255)\``, … */
function dataType(arg: string | undefined): string {
  if (!arg) return "";
  const plain = literal(arg);
  if (plain !== undefined) return plain.trim().toLowerCase();
  const raw = arg.match(/^sql(?:\.raw)?\s*(?:`([^`$]*)`|\(\s*["'`]([^"'`$]*)["'`]\s*\))$/);
  return (raw?.[1] ?? raw?.[2] ?? "").trim().toLowerCase();
}

/** Table name without a schema prefix: `public.users` → `users`. */
function tableName(arg: string | undefined): string | undefined {
  const name = literal(arg);
  return name?.split(".").pop();
}

const STATEMENT = /\.(createTable|alterTable|dropTable)\s*\(/g;
const COLUMN_CALL =
  /\.(addColumn|modifyColumn|dropColumn|renameColumn|alterColumn|renameTo|addPrimaryKeyConstraint)\s*\(/g;

function applyMigration(tables: Map<string, MigrationTable>, code: string, file: string) {
  const statements = [...code.matchAll(STATEMENT)];
  statements.forEach((match, index) => {
    const open = match.index! + match[0].length - 1;
    const { inner, end } = readCall(code, open);
    const name = tableName(splitArgs(inner)[0]);
    if (!name) return;
    const kind = match[1];
    if (kind === "dropTable") {
      tables.delete(name);
      return;
    }
    // The chain runs until the next schema statement.
    const chainEnd = index + 1 < statements.length ? statements[index + 1].index! : code.length;
    const chain = code.slice(end, chainEnd);
    let table = tables.get(name);
    if (kind === "createTable") {
      table = { name, columns: [], createdIn: file };
      tables.set(name, table);
    }
    if (table) applyChain(tables, table, chain);
  });
}

function applyChain(tables: Map<string, MigrationTable>, table: MigrationTable, chain: string) {
  for (const match of chain.matchAll(COLUMN_CALL)) {
    const open = match.index! + match[0].length - 1;
    const args = splitArgs(readCall(chain, open).inner);
    const name = literal(args[0]);
    const index = name === undefined ? -1 : table.columns.findIndex((c) => c.name === name);

    switch (match[1]) {
      case "addColumn":
      case "modifyColumn": {
        if (name === undefined) break;
        const column = parseColumn(name, args[1], args[2] ?? "");
        if (index === -1) table.columns.push(column);
        else table.columns[index] = column;
        break;
      }
      case "dropColumn":
        if (index !== -1) table.columns.splice(index, 1);
        break;
      case "renameColumn": {
        const to = literal(args[1]);
        if (index !== -1 && to) table.columns[index] = { ...table.columns[index], name: to };
        break;
      }
      case "alterColumn": {
        if (index === -1) break;
        const column = table.columns[index];
        const change = args[1] ?? "";
        const setType = change.match(/\.setDataType\s*\(([^)]*)\)/);
        if (setType) column.type = dataType(setType[1].trim());
        if (/\.setNotNull\s*\(/.test(change)) column.notNull = true;
        if (/\.dropNotNull\s*\(/.test(change)) column.notNull = false;
        if (/\.setDefault\s*\(/.test(change)) column.generated = true;
        if (/\.dropDefault\s*\(/.test(change)) column.generated = column.autoIncrement;
        break;
      }
      case "renameTo": {
        if (name === undefined) break;
        tables.delete(table.name);
        table.name = name;
        tables.set(name, table);
        break;
      }
      case "addPrimaryKeyConstraint": {
        const columns = (args[1]?.match(/["'`][^"'`]+["'`]/g) ?? []).map((c) => c.slice(1, -1));
        for (const column of table.columns) {
          if (columns.includes(column.name)) {
            column.primaryKey = true;
            column.notNull = true;
          }
        }
        break;
      }
    }
  }
}

function parseColumn(name: string, typeArg: string | undefined, build: string): MigrationColumn {
  const type = dataType(typeArg);
  const autoIncrement =
    /\.(autoIncrement|identity|generatedAlwaysAsIdentity|generatedByDefaultAsIdentity)\s*\(/.test(build) ||
    /^(small|big)?serial\d?$/.test(type);
  const primaryKey = /\.primaryKey\s*\(/.test(build);
  return {
    name,
    type,
    notNull: primaryKey || autoIncrement || /\.notNull\s*\(/.test(build),
    primaryKey,
    autoIncrement,
    generated: autoIncrement || /\.(defaultTo|generatedAlwaysAs)\s*\(/.test(build),
  };
}
