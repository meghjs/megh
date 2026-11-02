---
title: Megh Commands
description: Useful commands
---

# Megh Commands

Install the CLI globally, or run it with `npx`:

```sh
npm i -g @meghjs/cli
```

## Command Overview

| Command | Alias | Description |
|---------|-------|-------------|
| `new` | | Create a new application |
| `serve` | | Start the dev server with watch + rebuild |
| `build` | | Compile using `tsconfig.build.json` |
| `make:model` | `m:m` | Create an ORM model (columns from its migrations) or TypeORM entity |
| `make:resource` | `m:r` | Create a REST resource for a model: DTOs, CRUD service and controller |
| `make:controller` | `m:c` | Create a controller |
| `make:service` | `m:s` | Create a service |
| `make:config` | `m:cnf` | Create a config class |
| `make:middleware` | `m:mlwr` | Create a middleware |
| `make:migration` | `m:mig` | Create a database migration |
| `migrate` | | Run pending migrations |
| `migrate:status` | | Show which migrations have run |
| `migrate:rollback` | | Undo the last migration (`--step <n>` for more) |
| `migrate:reset` | | Undo every migration |
| `migrate:refresh` | | Undo every migration, then run them all again |

Every `make:*` command takes `-f` / `--force` to overwrite an existing file.

## Application

```sh
npx @meghjs/cli new myapi
```

You are prompted for a package manager and optional features — OpenAPI docs,
CORS, TypeORM, Knex and Scalar UI. Then:

```sh
cd myapi
npm run start:dev
```

## Development Server

```sh
npx megh serve
```

Compiles `src/` with SWC into `dist/`, starts the app and restarts it on change.
The entry point comes from `megh.entry` in `package.json`, falling back to `main`.

## Resource

```sh
npx megh make:resource user
# shorthand
npx megh m:r user
```

Generates a complete REST resource for a [Megh ORM](/advanced/orm) model:

| File | Contents |
|------|----------|
| `src/models/user.model.ts` | Reused if it exists; otherwise built from the migration that creates `users` (as `make:model` does) |
| `src/dtos/user.dto.ts` | `CreateUserDto`, `UpdateUserDto` (every field optional) and `ListUsersQuery` (`page`, `perPage`) |
| `src/services/user.service.ts` | `findAll`, `paginate`, `find`, `findOrFail`, `create`, `update`, `delete` |
| `src/controllers/user.controller.ts` | `GET /users`, `GET /users/:id`, `POST /users`, `PUT /users/:id`, `DELETE /users/:id` |

The DTO validators come from the model's fields and the migration's column
types: `varchar(255)` gets `@MaxLength(255)`, an `email` column `@IsEmail()`,
nullable columns and columns with a default are optional, and the generated
primary key and timestamps are left out. A missing row gives a 404.

If there is neither a model nor a migration for the table, nothing is
written; create the migration first (`megh make:migration create_users_table`).
Use `--table <name>` when the table name isn't the plural snake_case name, and
`-f` to overwrite existing DTO, service and controller files. Nested names
work too: `megh m:r admin/user` serves `/admin/users`.

If the model is a TypeORM entity, the service uses its repository and no DTOs
are generated.

Register the controller in your app:

```ts
app.useControllers([UserController]);
```

## Controller

```sh
npx megh make:controller user
# shorthand
npx megh m:c user
```

Pass `-r` for a full REST skeleton, and `-m <model>` to bind it to a model:

```sh
npx megh m:c user -m user -r
```

With `-m`, the controller is generated like [`make:resource`](#resource): the model's
DTOs, service and model (from its migration) are created if missing, and the
controller delegates to the service. Add `--orm` to back that service with a
TypeORM repository instead.

Use `-rt <dir>` to place the file under a different directory, and `--base-path`
to emit `@ApiController` without a route prefix.

## Service

```sh
npx megh make:service user
```

A resource service uses the [Megh ORM](/advanced/orm) model (generated from its
migration if it doesn't exist yet):

```sh
npx megh make:service user -m user -r
```

Add `--orm` for one backed by a TypeORM repository:

```sh
npx megh make:service user -m user -r --orm
```

## Model

```sh
# Megh ORM model
npx megh make:model user
npx megh make:model user --table app_users   # table name other than "users"

# TypeORM entity
npx megh m:m user --orm
```

`make:model` writes a [Megh ORM](/advanced/orm) model. It looks for the
model's table (by default the plural snake_case name: `User` → `users`,
`BlogPost` → `blog_posts`) in your migrations. If one creates it, the model
gets a field for every column, with its type, nullability and casts, plus
`primaryKey`, `generated`, `timestamps` and `softDeletes` as needed. Later
migrations that add, drop or rename columns are taken into account:

```ts
// Columns read from the migrations (the table is created in 20260101000000_create_users_table.ts).
export class User extends Model {
  static readonly table = "users";
  static readonly timestamps = true;
  static readonly casts = {
    is_admin: "boolean",
  } as const;

  id!: number;
  email!: string;
  name!: string | null;
  is_admin!: boolean;
  created_at!: Date;
  updated_at!: Date;
}
```

If no migration creates the table, you get a model with placeholder columns
to fill in. The migrations are read, not run, so no database is needed.
Relations aren't generated; add them yourself.

## Middleware

```sh
npx megh make:middleware auth
```

Generates a class extending `MeghMiddleware`:

```ts [src/middlewares/auth.middleware.ts]
import { AppMiddleware, MeghMiddleware, IRequest, IResponse } from '@meghjs/core';

@AppMiddleware
export class AuthMiddleware extends MeghMiddleware {
  async invoke(req: IRequest, res?: IResponse) {
    // your logic goes here
    return req;
  }
}
```

## Config

```sh
npx megh make:config jwt
```

Generates a class extending `MeghConfig` and registered with `@AppConfig`:

```ts [src/config/jwt.config.ts]
import { AppConfig, MeghConfig, Environment } from '@meghjs/core';

@AppConfig
export class JwtConfig extends MeghConfig {
  config(env: Environment) {
    return {};
  }
}
```

## Migrations

```sh
npx megh make:migration create_users_table
npx megh migrate
```

`make:migration` writes `src/database/migrations/<timestamp>_<name>.ts`.
A `create_<table>_table` name gives a create-table migration, and
`add_<x>_to_<table>_table` an alter-table one; `--create <table>` and
`--table <table>` choose explicitly.

The `migrate` commands load the Kysely instance exported from
`src/database/connection.ts`. Set `megh.database` and `megh.migrations` in
`package.json` to use other paths. See [Models (ORM): Migrations](/advanced/orm#migrations).

## Build

```sh
npx megh build
```

Removes `dist/` and compiles the project with `tsconfig.build.json`.
