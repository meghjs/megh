---
title: Database Commands
description: Running migrations, seeders and factories with the Megh CLI.
---

# Database Commands

These commands create and run migrations, seeders and factories.

## Migrations

```sh
npx megh make:migration create_users_table
npx megh migrate
```

`make:migration` writes `src/database/migrations/<timestamp>_<name>.ts`.
A `create_<table>_table` name gives a create-table migration, and
`add_<x>_to_<table>_table` an alter-table one; `--create <table>` and
`--table <table>` choose explicitly.

The `migrate` commands connect the way `app.useMeghORM()` does, from
`DATABASE_URL` (or the `DB_*` variables) in the environment or `.env`. Set
`megh.migrations` in `package.json` to use another folder. See
[MeghORM: Migrations](/advanced/orm/migrations).

By default they compile `src/` with SWC into `.megh/migrate` first. With
`--compiled` they run the `.js` files `megh build` wrote to the tsconfig
`outDir` instead (`dist/database/migrations`, or
`dist/src/database/migrations` when `rootDir` isn't set), so neither the
sources nor a writable project folder are needed. This happens automatically when
there is no `src/` folder, as in a production image. Every `migrate*`
command and `db:seed` accepts `--compiled`.

```sh
npx megh build
npx megh migrate --compiled
```

## Seeders

```sh
npx megh make:seeder roles
npx megh make:seeder users
npx megh make:seeder database   # the entry seeder: calls roles, then users
npx megh db:seed
```

`make:seeder` writes `src/database/seeders/<name>.seeder.ts`
(`UserSeeder` and `user_seeder` both become `user.seeder.ts`):

```ts [src/database/seeders/roles.seeder.ts]
import { defineSeeder } from '@meghjs/core';
import { Role } from '../../models/role.model';

export default defineSeeder({
  async run() {
    await Role.create({ name: 'Admin' });
    await Role.create({ name: 'Editor' });
  },
});
```

`db:seed` runs the `database` seeder, which calls the others in the order you
choose; `make:seeder database` fills that in from the seeders that already
exist. Without a `database` seeder, every seeder runs in file-name order.

```sh
npx megh db:seed --seeder users       # just one (also -s)
npx megh migrate --seed               # migrate, then seed
npx megh migrate:refresh --seed       # rebuild the schema and seed it
```

A whole run is one transaction: if a seeder throws, nothing is saved and the
error names the seeder. Seeding refuses to run when `NODE_ENV` is
`production` unless you pass `--force`. Set `megh.seeders` in `package.json`
to use another folder. See [MeghORM: Seeding](/advanced/orm/seeding#seeding).

## Factories

```sh
npx megh make:factory role
npx megh make:factory user
```

`make:factory` reads the model's columns and writes
`src/database/factories/<name>.factory.ts` with a [Faker](https://fakerjs.dev)
value for each, picked from the column's name and type:

```ts [src/database/factories/user.factory.ts]
import { defineFactory } from "@meghjs/core";
import { User } from "../../models/user.model";
import { RoleFactory } from "./role.factory";

export const UserFactory = defineFactory(User, ({ faker }) => ({
  name: faker.person.fullName(),
  email: faker.internet.email(),
  phone: faker.phone.number({ style: "international" }).slice(0, 20),
  is_active: faker.datatype.boolean(),
  role_id: RoleFactory,
}));
```

A foreign key such as `role_id` uses `RoleFactory` when that factory exists,
so create the related model's factory first; otherwise it is left as a
comment (or `null` for a nullable key). Values are kept within short
`varchar(n)` columns. The generated key and timestamps are left out. Edit the
result freely: it's your code.

Factories need `@faker-js/faker` (`npm install -D @faker-js/faker`); `megh new`
adds it to projects with MeghORM. Set `megh.factories` in `package.json` to use
another folder. See [MeghORM: Factories](/advanced/orm/seeding#factories).
