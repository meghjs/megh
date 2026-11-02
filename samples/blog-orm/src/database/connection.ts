import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';

/**
 * The app's database. `megh migrate` loads this module too.
 * DB_FILE defaults to database.sqlite in the project root; tests use ":memory:".
 */
const db = new Kysely<any>({
  dialect: new SqliteDialect({
    database: new Database(process.env.DB_FILE || 'database.sqlite'),
  }),
});

export default db;
