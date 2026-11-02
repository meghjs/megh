/**
 * @copyright 2024
 * @author Tareq Hossain
 * @email xtrinsic96@gmail.com
 * @url https://github.com/xtareq
 *
 * The ORM's Kysely connection, and the transaction the current async call
 * chain runs in. Only Kysely's types are imported: the app passes its own
 * Kysely instance, so core never loads Kysely itself.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Kysely, Transaction } from "kysely";
import { Container, Token } from "../di";
import { loadPackageFromClient } from "../common/utils/common-utils";
import { usesAdapter } from "./casts";

/** DI token holding the ORM's root Kysely instance. */
export const ORM_CONNECTION = new Token<Kysely<any>>("MEGH_ORM_CONNECTION");

const currentTransaction = new AsyncLocalStorage<Transaction<any>>();

export function setConnection(db: Kysely<any>) {
  Container.set(ORM_CONNECTION, db);
}

function rootConnection(): Kysely<any> {
  if (!Container.has(ORM_CONNECTION)) {
    throw new Error(
      "[Megh ORM] No database connection. Call app.useDatabase(kysely) " +
        "(or Model.useConnection(kysely) outside an app) first.",
    );
  }
  return Container.get(ORM_CONNECTION);
}

/** The transaction this call chain runs in, else the root connection. */
export function getConnection(): Kysely<any> {
  return currentTransaction.getStore() ?? rootConnection();
}

/**
 * Run `fn` in a transaction. Every model query made inside it, however deep
 * in the call chain, uses the transaction. The transaction commits when `fn`
 * resolves and rolls back if it throws.
 *
 * A nested call joins the outer transaction; with `savepoint: true` it runs
 * in a savepoint instead, so its failure rolls back only its own work.
 */
export function runInTransaction<T>(
  fn: (trx: Transaction<any>) => Promise<T>,
  options: { savepoint?: boolean } = {},
): Promise<T> {
  const outer = currentTransaction.getStore();
  if (outer) return options.savepoint ? inSavepoint(outer, fn) : fn(outer);
  return rootConnection()
    .transaction()
    .execute((trx) => currentTransaction.run(trx, () => fn(trx)));
}

let savepoints = 0;

async function inSavepoint<T>(
  trx: Transaction<any>,
  fn: (trx: Transaction<any>) => Promise<T>,
): Promise<T> {
  const name = `megh_sp_${++savepoints}`;
  // SQL Server has its own syntax and no RELEASE.
  const mssql = usesAdapter(trx, "MssqlAdapter");
  const run = (text: string) => raw(text).execute(trx);
  await run(mssql ? `save transaction ${name}` : `savepoint ${name}`);
  try {
    const result = await fn(trx);
    if (!mssql) await run(`release savepoint ${name}`);
    return result;
  } catch (err) {
    await run(
      mssql ? `rollback transaction ${name}` : `rollback to savepoint ${name}`,
    );
    if (!mssql) await run(`release savepoint ${name}`);
    throw err;
  }
}

/** A raw SQL statement, built with the app's Kysely (core never bundles it). */
function raw(text: string): { execute(db: Kysely<any>): Promise<unknown> } {
  return loadPackageFromClient("kysely").sql.raw(text);
}
