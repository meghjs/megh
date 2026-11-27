---
title: CLI
description: "The megh command: create, run and build apps, generate code and manage the database."
---

# CLI

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
| `make:model` | `m:m` | Create a model: a plain class, a MeghORM model with `--orm` (columns from its migrations), or a TypeORM entity with `--typeorm` |
| `sync:model` | `s:m` | Sync an existing model's columns with its migrations (was `update:model`) |
| `make:resource` | `m:r` | Create a REST resource for a model: DTOs, CRUD service and controller |
| `make:controller` | `m:c` | Create a controller |
| `make:service` | `m:s` | Create a service |
| `make:config` | `m:cnf` | Create a config class |
| `make:middleware` | `m:mlwr` | Create a middleware |
| `make:mail` | `m:mail` | Create a Mailable in `src/mail/` |
| `make:event` | `m:ev` | Create an event in `src/events/` |
| `make:listener` | `m:lsn` | Create an event listener in `src/listeners/` (`--event` to type it) |
| `make:queue` | `m:q` | Create a queue with a job handler in `src/queues/` |
| `make:worker` | `m:w` | Create a worker for a queue in `src/workers/` |
| `make:task` | `m:task`, `make:scheduler` | Create a scheduled task in `src/tasks/` (`--cron`, `--interval`) |
| `make:dto` | `m:dto` | Create a DTO in `src/dtos/` |
| `make:class` | `m:cls` | Create a plain class in `src/classes/` |
| `make:view` | `m:v` | Create a `.megh.html` view (or `-c` component) in `views/` |
| `make:test` | `m:t` | Create a unit test (`<name>.spec.ts`) for an existing file |
| `make:migration` | `m:mig` | Create a database migration |
| `make:seeder` | `m:sd` | Create a database seeder |
| `make:factory` | `m:f` | Create a model factory with Faker values |
| `migrate` | | Run pending migrations (`--seed` to seed afterwards) |
| `migrate:status` | | Show which migrations have run |
| `migrate:rollback` | | Undo the last migration (`--step <n>` for more) |
| `migrate:reset` | | Undo every migration |
| `migrate:refresh` | | Undo every migration, then run them all again (`--seed` too) |
| `db:seed` | | Run the seeders (`--seeder <name>` for one) |
| `scaffold:domain` | `sc:domain` | Create the tables and models (or resources) of a business domain |
| `scaffold:auth` | `sc:auth` | Add sign-up and sign-in with JWTs and/or API keys, optionally with roles |
| `scaffold:rbac` | `sc:rbac` | Add roles and permissions to an app's users |
| `template:list` | `templates` | List the model templates |
| `make:agents` | | Write `AGENTS.md` (and a `CLAUDE.md` that imports it) for coding agents |

Every `make:*` command takes `-f` / `--force` to overwrite an existing file.
The generators except `make:model` and the database ones (`make:migration`,
`make:seeder`, `make:factory`) also write a unit test next to the file; pass
`--notest` (or `-nt`) to skip it. See [Tests](/cli/generators#tests).
`make:model` and `make:resource` also build the table from a
[template](/cli/scaffold/templates) with `--template` or `--fields`.

## Pages

| Page | Commands |
|---|---|
| [Generators](/cli/generators) | `make:resource`, `make:controller`, `make:service`, `make:model`, `sync:model`, `make:middleware`, `make:config`, `make:mail`, `make:event`, `make:listener`, `make:queue`, `make:worker`, `make:task`, `make:dto`, `make:class`, `make:test` |
| [Database Commands](/cli/database) | `make:migration`, `migrate*`, `make:seeder`, `db:seed`, `make:factory` |
| [Scaffold](/cli/scaffold/) | `--template`, `--fields`, `scaffold:domain`, `scaffold:auth`, `scaffold:rbac`, `template:list` |

## Version and info

```sh
npx megh -v       # the CLI version, e.g. 0.7.3 (also --version)
npx megh --info   # the logo, CLI, Node.js and OS versions, and the project's Megh packages (also -i)
```

The logo appears only with `--info`; `-v`, `--help` and the other commands
print without it. `--info` also shows the installed `@meghjs/core`, `@meghjs/data`
and TypeScript versions when run inside an app: paste it into a bug report.

## Application

```sh
npx @meghjs/cli new myapi
```

You are prompted for a package manager and optional features: OpenAPI docs,
CORS and MeghORM. With MeghORM you also pick the database. Add
[Mail](/advanced/mail#setting-it-up), Scalar UI or the
[`@meghjs/data`](/advanced/database) plugin afterwards. Non-interactively:

```sh
npx @meghjs/cli new myapi --yes --database postgres   # also: mysql, sqlite, mssql
```

`--database` (or the `orm` feature, which defaults to SQLite) installs the
driver, adds `app.useMeghORM()` to `src/app.ts`, writes `DATABASE_URL` to
`.env` and creates `src/database/migrations/`.

For a server-rendered app, pass `--mvc`:

```sh
npx @meghjs/cli new myapp --mvc
```

It adds `app.useViews()` and `app.useMethodOverride()` to `src/app.ts`, a
layout in `views/layouts/app.megh.html`, a page in `views/pages/home.megh.html`,
and a `HomeController` that renders it with `Results.View('pages.home', ...)`.
Add more pages with [`make:view`](/cli/generators#view). See
[Views](/advanced/views). `--mvc` can't be combined with `--minimal`.

The project also gets an `AGENTS.md`: instructions for coding agents such as
Claude Code, Codex, Cursor and Copilot. It lists the project's commands, where
code goes, and the Megh rules that compile cleanly but fail at runtime
(register new controllers, give every DTO property a validator, and so on). A
`CLAUDE.md` containing `@AGENTS.md` makes Claude Code read the same file. Edit
both freely: they're yours. To add them to an existing project, run
`npx megh make:agents` (`--force` replaces an existing `AGENTS.md`; a
`CLAUDE.md` of your own is never replaced).

The new project is put under git with `git init`, unless git isn't installed
or the folder is already inside a repository. Pass `--skip-git` (or set
`MEGH_SKIP_GIT=1`) to skip it. Then:

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

## Build

```sh
npx megh build
```

Removes the output folder (`outDir`, usually `dist/`) and compiles the project with `tsconfig.build.json`.
