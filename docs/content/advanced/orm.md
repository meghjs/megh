---
title: Models (ORM)
description: "Megh's built-in, type-safe models on top of Kysely: queries, relations, timestamps, soft deletes, casts and migrations."
---

# Models (ORM)

`@meghjs/core` includes a model layer in the style of Laravel's Eloquent. It is
built on [Kysely](https://kysely.dev): your models are plain classes, and
column names, value types and loaded relations are checked by TypeScript.

```ts
const users = await User.where('email', 'like', '%@acme.io')
  .with('posts.comments')
  .orderBy('name')
  .get();

users[0].posts[0].comments[0].body; // typed
User.where('emial', 'x');           // compile error: '"emial"' is not assignable to '"id" | "email" | "name"'
```

## Installation

Install Kysely and the driver for your database:

::: code-group
```sh [PostgreSQL]
npm i kysely pg
```
```sh [MySQL]
npm i kysely mysql2
```
```sh [SQLite]
npm i kysely better-sqlite3
```
:::

::: info Node.js version
Kysely 0.29 ships ES modules only and needs Node.js 22 or later. Megh apps
compile to CommonJS, which loads them through `require()` support for ES
modules (Node.js 22.12+). On older Node.js versions, use Kysely 0.27.
:::

## Connecting

Create the Kysely instance in its own module. The app uses it, and the
[migration commands](#migrations) load it from this file.

::: code-group
```ts [PostgreSQL]
// src/database/connection.ts
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

const db = new Kysely<any>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: process.env.DATABASE_URL }),
  }),
});

export default db;
```
```ts [MySQL]
// src/database/connection.ts
import { Kysely, MysqlDialect } from 'kysely';
import { createPool } from 'mysql2';

const db = new Kysely<any>({
  dialect: new MysqlDialect({ pool: createPool(process.env.DATABASE_URL!) }),
});

export default db;
```
```ts [SQLite]
// src/database/connection.ts
import { Kysely, SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';

const db = new Kysely<any>({
  dialect: new SqliteDialect({ database: new Database('database.sqlite') }),
});

export default db;
```
:::

Then hand it to the app:

```ts [app.ts]
import { Megh } from '@meghjs/core';
import db from './database/connection';

const app = Megh.createApplication();
app.useDatabase(db);
```

`useDatabase` sets the connection models use, registers it in the container
under `ORM_CONNECTION`, and destroys it when the app shuts down. Outside an app, in
scripts and tests, call `Model.useConnection(db)` instead.

## Defining models

Extend `Model`, name the table, and declare the columns as fields:

```ts [src/models/user.model.ts]
import { Model, hasMany } from '@meghjs/core';
import { Post } from './post.model';

export class User extends Model {
  static readonly table = 'users';

  id!: number;
  email!: string;
  name!: string | null;

  posts = hasMany(() => Post);

  get displayName() {
    return this.name ?? this.email;
  }

  greet() {
    return `Hi ${this.displayName}`;
  }
}
```

Every field is a column, except:

- **relations**, declared with `hasMany()`, `hasOne()`, `belongsTo()` or `belongsToMany()`
- **methods**
- **getters** and other `readonly` properties, which count as computed values.
  This means a column itself must not be `readonly`.

Query results are instances of the model, so methods and getters work on them.

| Static field | Default | Purpose |
|---|---|---|
| `table` | — (required) | Table name |
| `primaryKey` | `'id'` | Primary key column |
| `generated` | `['id']` | Columns the database fills in; optional in `create()`. Declare a literal: `['id', 'slug'] as const` |
| `timestamps` | `false` | See [Timestamps](#timestamps) |
| `softDeletes` | `false` | See [Soft deletes](#soft-deletes) |
| `casts` | `{}` | See [Casts](#casts) |

## Querying

```ts
await User.all();
await User.find(1);              // User | undefined
await User.findOrFail(1);        // throws a 404 NotFoundException if missing
await User.findBy('email', 'ann@acme.io');       // first match, or undefined
await User.findBy({ email: 'ann@acme.io', active: true });
await User.findByOrFail('email', 'ann@acme.io'); // or a 404

await User.where('email', 'ann@acme.io').first();
await User.where('id', '>', 10).orderBy('name', 'desc').limit(10).offset(20).get();
await User.where('name', null).get();          // IS NULL
await User.query().whereIn('id', [1, 2, 3]).get();
await User.query().whereNotNull('name').count();
await User.where('email', 'ann@acme.io').exists();
```

`User.where()`, `User.with()`, `User.whereHas()`, `User.withCount()` and
`User.scope()` start a query; `User.query()` starts an empty one. Nothing runs
until `get()`, `first()`, `firstOrFail()`, `count()`, `exists()`, an aggregate,
a paginate method, `update()` or `delete()` is called.

Pass a callback for anything else Kysely can express, such as `OR` groups:

```ts
await User.where((eb) => eb.or([eb('role', '=', 'admin'), eb('id', '=', 1)])).get();
```

`select()` fetches only some columns, and the result type narrows to them:

```ts
const rows = await User.query().select('id', 'email').get();
rows[0].email; // string
rows[0].name;  // compile error
```

### Aggregates

```ts
await Post.count();
await Post.sum('views');                         // 0 when no rows match
await Post.where('user_id', 1).avg('views');     // null when no rows match
await Post.min('published_on');                  // casts apply: a Date here
await Post.max('views');
```

Aggregates respect filters and soft deletes, like every other query.

### Scopes

A scope is a reusable piece of a query, typed for its model:

```ts
import type { Scope } from '@meghjs/core';

const published: Scope<Post> = (q) => q.whereNotNull('published_on');
const byAuthor: Scope<Post, [number]> = (q, userId) => q.where('user_id', userId);

await Post.scope(published).scope(byAuthor, 1).orderBy('id').get();
```

### Pagination

`paginate()` returns the same `{ data, meta }` shape as the rest of Megh:

```ts
const page = await Post.query().orderBy('id').paginate({ page: 2, perPage: 20 });
// page.meta → { total, page, perPage, lastPage, next, prev }
await Post.paginate({ page: 1 }); // every row
```

`simplePaginate()` skips the `count(*)` query, which is costly on large
tables. It fetches one extra row to tell whether another page follows:

```ts
const page = await Post.query().simplePaginate({ page: 2, perPage: 20 });
// page.meta → { page, perPage, hasMore, next, prev }
```

`cursorPaginate()` pages by key instead of by offset. Pages stay stable when
rows are inserted, and deep pages are as fast as the first. Pass the returned
`nextCursor` back to get the next page:

```ts
const first = await Post.where('published', true).cursorPaginate({ perPage: 20 });
const next = await Post.where('published', true).cursorPaginate({
  perPage: 20,
  cursor: first.meta.nextCursor, // null on the last page
});
// meta → { perPage, hasMore, nextCursor }
```

It orders by the primary key by default; pass `column` (it must be unique)
and `direction: 'desc'` to change that. An invalid cursor throws a 400
`BadRequestException`.

## Creating, updating and deleting

```ts
// insert and return the stored row (generated columns included)
const user = await User.create({ email: 'ann@acme.io' }); // id generated, name nullable → optional

// or build an instance and save it
const bob = new User().fill({ email: 'bob@acme.io', name: 'Bob' });
await bob.save();

// save() updates only the columns that changed, and does nothing if none did
bob.name = 'Robert';
await bob.save(); // UPDATE users SET name = ? WHERE id = ?

await bob.delete();

// many rows at once; both return the number of rows affected
await Post.where('user_id', 1).update({ published: true });
await Post.where('published', false).delete();
```

`create()`'s argument is typed from the model: required columns must be
present, and generated, nullable and timestamp columns may be left out.

## Relations

```ts
class User extends Model {
  static readonly table = 'users';
  id!: number;

  posts = hasMany(() => Post);       // posts.user_id → users.id
  profile = hasOne(() => Profile);   // profiles.user_id → users.id
}

class Post extends Model {
  static readonly table = 'posts';
  id!: number;
  user_id!: number;

  author = belongsTo(() => User, 'user_id');
}
```

The related class is passed as a function, so models can refer to each other
in any order. Key defaults follow Laravel:

| Relation | Foreign key default | Arguments |
|---|---|---|
| `hasMany(() => Post)` | `<owner class>_id` on the related table, e.g. `user_id` | `(related, foreignKey?, localKey?)` |
| `hasOne(() => Profile)` | same as `hasMany` | `(related, foreignKey?, localKey?)` |
| `belongsTo(() => User)` | `<relation name>_id` on this table, e.g. `author_id` | `(related, foreignKey?, ownerKey?)` |

### Eager loading

Load relations with `with()`. Use dots for nested relations:

```ts
const users = await User.with('posts.comments', 'profile').get();

users[0].posts;          // Post[]
users[0].profile;        // Profile | null
users[0].posts[0].author; // compile error: not loaded
```

Each relation level is one query, however many rows there are:

```sql
select * from users
select * from posts where user_id in (?, ?)
select * from comments where post_id in (?, ?, ?)
select * from profiles where user_id in (?, ?)
```

### Querying by relation

`whereHas()` keeps rows that have a related row; `whereDoesntHave()` keeps
those that don't. Narrow the related rows with a callback, and follow nested
relations with dots:

```ts
await User.whereHas('posts').get();
await User.whereHas('posts', (q) => q.where('published', true)).get();
await User.whereHas('posts.comments', (q) => q.where('body', 'like', '%megh%')).get();
await User.whereDoesntHave('roles').delete();
```

Each one runs as an `EXISTS` subquery, so it works with `count()`,
`paginate()`, `update()` and `delete()` too. Soft-deleted related rows don't
count.

### Counting related rows

`withCount()` adds a `<relation>_count` number to each result, without loading
the rows:

```ts
const users = await User.withCount('posts', 'roles').get();
users[0].posts_count; // number

await User.query().withCount('posts', (q) => q.where('published', true)).get();
```

Counts appear in JSON but are never written back by `save()`.

### Creating related rows

`related()` on a `hasMany` or `hasOne` relation creates rows with the foreign
key already set:

```ts
const post = await user.related('posts').create({ title: 'Hello' }); // user_id set
await user.related('posts').createMany([{ title: 'A' }, { title: 'B' }]);
await user.related('posts').save(existingPost);  // moves it to this user
await user.related('posts').query().where('published', true).get();
const profile = await user.related('profile').get(); // Profile | null
```

### Many-to-many

```ts
class User extends Model {
  static readonly table = 'users';
  id!: number;

  roles = belongsToMany(() => Role).withPivot<{ granted_by: string | null }>('granted_by');
}
```

The pivot table defaults to both snake_case class names, sorted and joined:
`role_user`, with the columns `user_id` and `role_id`. Override any of these
with options:

```ts
roles = belongsToMany(() => Role, {
  table: 'user_roles',
  foreignPivotKey: 'member_id',
  relatedPivotKey: 'role_id',
});
```

Loaded models carry their pivot row in `pivot`, which also appears in JSON:

```ts
const user = await User.with('roles').firstOrFail();
user.roles[0].pivot.granted_by; // string | null
```

Change the links through `related()`:

```ts
await user.related('roles').attach([adminRole, 3], { granted_by: 'root' }); // models or keys
await user.related('roles').detach(adminRole);  // or detach() for all
await user.related('roles').sync([1, 2]);       // → { attached, detached }, in one transaction
const roles = await user.related('roles').get();
```

## Timestamps

```ts
class Post extends Model {
  static readonly table = 'posts';
  static readonly timestamps = true;

  id!: number;
  title!: string;
  created_at!: Date;
  updated_at!: Date;
}
```

`created_at` is set on insert, and `updated_at` on every insert and update:
`create()`, `save()`, query `update()`, and soft deletes and restores. Both are
read back as `Date`. Rename the columns with `static readonly createdAt` and
`static readonly updatedAt`.

## Soft deletes

```ts
class Post extends Model {
  static readonly table = 'posts';
  static readonly softDeletes = true;

  id!: number;
  deleted_at!: Date | null;
}
```

With soft deletes, `delete()` sets `deleted_at` instead of removing the row,
and every query, eager load included, leaves those rows out:

```ts
await post.delete();
post.isTrashed();                              // true
await Post.find(post.id);                      // undefined
await Post.withTrashed().find(post.id);        // still there
await Post.onlyTrashed().get();                // only deleted rows

await post.restore();
await Post.onlyTrashed().where('user_id', 1).restore();

await post.forceDelete();                      // really delete
await Post.onlyTrashed().forceDelete();
```

Rename the column with `static readonly deletedAt`.

## Casts

Casts convert between what the database stores and what the model holds:

```ts
class Member extends Model {
  static readonly table = 'members';
  static readonly casts = {
    is_admin: 'boolean',
    settings: 'json',
    born_on: 'date',
    balance: 'number',
  } as const;

  id!: number;
  is_admin!: boolean;
  settings!: { theme: string } | null;
  born_on!: Date | null;
  balance!: number;
}
```

| Cast | Read as | Written as |
|---|---|---|
| `'boolean'` | `true` / `false` (from `1`/`0`, `'true'`, …) | the boolean (`1`/`0` on SQLite) |
| `'number'` | a number, e.g. from Postgres `numeric` / `bigint` strings | the number |
| `'string'` | a string | the value |
| `'json'` | the parsed value | JSON text |
| `'date'` | a `Date` | `YYYY-MM-DD`, from the date's UTC parts |
| `'datetime'` | a `Date` | the `Date` (ISO text on SQLite) |
| `{ get, set }` | `get(stored)` | `set(value)` |

```ts
const csv: CustomCast<string[], string> = {
  get: (stored) => (stored === '' ? [] : stored.split(',')),
  set: (tags) => tags.join(','),
};
```

Timestamp and soft-delete columns are cast as `'datetime'` automatically.
`save()` notices changes made in place, such as `member.settings.theme = 'dark'`.

SQLite drivers can only bind numbers, strings and buffers, so on SQLite
`Date` values become ISO text and booleans become `1`/`0`, in `where()` too.

## Transactions

```ts
await Model.transaction(async () => {
  const user = await User.create({ email: 'ann@acme.io' });
  await Profile.create({ user_id: user.id, bio: '' });
});
```

Every model query inside the callback uses the transaction, even in functions
it calls. The transaction commits when the callback resolves and rolls back if
it throws.

A nested `Model.transaction()` runs in a savepoint. If it throws, only its own
work is rolled back, and the error still reaches the caller:

```ts
await Model.transaction(async () => {
  await Order.create({ total: 10 });
  try {
    await Model.transaction(async () => {
      await Invoice.create({ order_id: 1 });
      throw new Error('mailer down');
    });
  } catch {
    // the invoice is gone, the order is kept
  }
});
```

If the outer transaction rolls back, so does everything nested inside it.

## Raw queries

`Model.db()` returns the Kysely instance (the transaction, inside
`Model.transaction()`). Type it from your models with `DatabaseOf`:

```ts
import { Model, type DatabaseOf } from '@meghjs/core';

type DB = DatabaseOf<typeof User | typeof Post>;

const rows = await Model.db<DB>()
  .selectFrom('posts')
  .innerJoin('users', 'users.id', 'posts.user_id')
  .select(['posts.title', 'users.email'])
  .execute(); // { title: string; email: string }[]
```

The connection is also registered in the container under `ORM_CONNECTION`:

```ts
import { MeghContainer, ORM_CONNECTION } from '@meghjs/core';

const db = MeghContainer.get(ORM_CONNECTION); // Kysely<any>
```

## Migrations

A migration is a file in `src/database/migrations` that exports `up(db)` and,
to be reversible, `down(db)`. Both receive the Kysely instance and change the
schema with its [schema builder](https://kysely.dev/docs/migrations).
Migrations run in file-name order, so names start with a timestamp.

Create one with the CLI:

```sh
npx megh make:migration create_users_table
```

```ts [src/database/migrations/20261101093000_create_users_table.ts]
import type { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('email', 'text', (col) => col.notNull().unique())
    .addColumn('created_at', 'timestamp')
    .addColumn('updated_at', 'timestamp')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('users').execute();
}
```

The name picks the template:

- `create_<table>_table` gives a create-table migration. Its `id` column suits
  the project's driver: `serial` with `pg`, an identity column with `tedious`,
  and auto-increment otherwise.
- `add_<x>_to_<table>_table` (also `remove`/`drop`/`alter`/`change`/`update`,
  with `to`/`from`/`in`/`on`) gives an alter-table one.
- Anything else gives an empty migration.

`--create <table>` and `--table <table>` choose the template explicitly.

Then run them:

| Command | |
|---|---|
| `megh migrate` | Run pending migrations |
| `megh migrate:status` | Show which have run (`--json` for JSON) |
| `megh migrate:rollback` | Undo the last migration; `--step <n>` for more |
| `megh migrate:reset` | Undo every migration |
| `megh migrate:refresh` | Undo every migration, then run them all again |

The commands compile `src/` with SWC, load `.env`, and import the Kysely
instance from `src/database/connection.ts` (its default export, or an export
named `db`). To use other locations, set them in `package.json`:

```json [package.json]
{
  "megh": {
    "database": "src/db/index.ts",
    "migrations": "migrations"
  }
}
```

A failing migration stops the run, and the error names it. What happens to
the migrations before it depends on the database:

- **PostgreSQL and SQL Server** support transactional DDL, so the whole run is
  one transaction: a failure rolls back every migration in that run.
- **MySQL and SQLite** don't, so migrations that ran before the failure stay
  applied. The error lists them.

Executed migrations are recorded in Kysely's `kysely_migration` table, so
projects already using Kysely migrations keep their history.

### Running migrations from code

`Migrations` runs the same operations from code, for example in test setup or
at deploy time:

```ts
import { Migrations } from '@meghjs/core';
import db from './database/connection';

const migrations = new Migrations(db, { folder: `${__dirname}/database/migrations` });
await migrations.latest();     // names that ran
await migrations.rollback(2);
await migrations.status();     // [{ name, executedAt }]
```

Pass `migrations: { name: { up, down } }` instead of `folder` to define them
inline, and `table` / `lockTable` to change the bookkeeping table names. A
failed run throws a `MigrationError` with `migration` (the one that failed) and
`completed` (those that ran before it; on PostgreSQL and SQL Server they were
rolled back with it).

## Generating models

`npx megh make:model user` writes `src/models/user.model.ts`, with its
columns read from the migrations that create and change the `users` table.
See [CLI: Model](/cli/basic#model).

## Testing

The ORM is tested against SQLite. The MySQL path for reading back inserted
rows, which has no `RETURNING`, is implemented but not yet covered by tests.
