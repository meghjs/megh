---
title: Deployment
description: Building a Megh app, running it in production, containers, process managers and migrations.
---

# Deployment

A Megh app is a plain Node.js program. You compile it to JavaScript, set
`NODE_ENV=production`, and run the entry file with Node 22 or newer.

## Building

```bash
npx megh build      # or: npm run build in a scaffolded app
```

`megh build` compiles the project with the project's own `tsc`:

- It uses `tsconfig.build.json`, else `tsconfig.json` (with a warning), or
  the file passed with `-p, --project <file>`.
- It deletes the output folder (`outDir`, default `dist`) first.
- It copies every non-TypeScript file under `src/` (JSON, templates, images…)
  into the output folder. Dotfiles are skipped.
- It fails if `typescript` is not installed in the project.

The output is **CommonJS**, one `.js` file per source file:
`src/serve.ts` becomes `dist/serve.js`, and `src/controllers/` becomes
`dist/controllers/`. Megh itself ships only a CommonJS build. Keep
`"module": "CommonJS"` in `tsconfig.json`, as the scaffold does.

You can also run `tsc -p tsconfig.build.json` directly. You then have to copy
any assets yourself.

## Starting

```bash
npx megh start      # or: npm start
```

`megh start` runs the compiled entry with `node --enable-source-maps`. It sets
`NODE_ENV=production` unless `NODE_ENV` is already set, and forwards `SIGINT`
and `SIGTERM` to the app. It looks for the entry in this order:

1. `--entry <file>`
2. `megh.entry` in `package.json`
3. `main` in `package.json` (a `src/*.ts` path is mapped to the output folder)
4. `serve.js`, `server.js`, `main.js`, `index.js` in the output folder

If none exists it stops with `No compiled entry file found (tried …)` and
asks you to run `megh build` first or pass `--entry`.

`megh start` is optional. Running Node yourself works the same:

```bash
NODE_ENV=production node --enable-source-maps dist/serve.js
```

Start the app from the project root. Megh reads `.env` and resolves
auto-discovered folders (`src/controllers`, `src/tasks`) relative to the
current working directory.

## Environment

| Variable | Effect |
|----------|--------|
| `NODE_ENV` | Anything other than `development` (including unset) is production |
| `HOST` | Interface `run()` listens on. Default `0.0.0.0` |
| `PORT` | Port `run()` listens on when you don't pass one. Default `4000` |
| `LOG_LEVEL` | Log level. Default `info` |
| `MEGH_DOTENV` | `false` stops Megh loading `.env` |
| `DATABASE_URL`, `DB_*` | MeghORM connection |

In production mode (`app.isDevelopment()` is `false`):

- 5xx responses say only `Internal Server Error`, without the message, data or
  stack. See [Error Handling](/core-concept/error-handling).
- Logs are JSON lines on stdout, even if `pino-pretty` is installed. See
  [Logging](/advanced/logging).
- `/ready` leaves out the reason a health check failed.
- Anything you put behind `if (app.isDevelopment())`, such as the OpenAPI
  docs in the scaffold, is off.

::: warning Keep `NODE_ENV=development` out of a deployed `.env`
Values already in the environment win over `.env`. If a `.env` in the working
directory sets `NODE_ENV=development` and nothing else sets `NODE_ENV`, the app
runs in development mode and sends error details to clients. Projects created
with 0.6.0 or later leave `NODE_ENV` out of `.env`; older projects should
remove it. Don't ship `.env` to production; set real environment variables
instead.
:::

`app.run()` listens on `PORT`, else `4000`, unless you pass a port. A port
passed to `run()` wins. An invalid `PORT` stops startup with an error.

See [Configuration](/core-concept/configuration) for typed config classes.

## Health checks

Turn on `/health` and `/ready` for load balancers and orchestrators:

```ts
app.useHealth();
```

Point liveness probes at `/health` and readiness probes at `/ready`. Both
skip middleware and `@Authorized`. See [Health Checks](/advanced/health).

## Graceful shutdown

On `SIGTERM` or `SIGINT`, `run()` stops accepting connections, waits for
in-flight requests, stops scheduled tasks and workers, runs `onClose` hooks
and exits with code 0. It exits with code 1 if that takes longer than
`shutdownTimeout` (default 10 seconds). See
[Application: Shutting down](/getting-started/application#shutting-down).

Give the app at least `shutdownTimeout` before your platform kills it. In
Kubernetes, `terminationGracePeriodSeconds` defaults to 30 seconds, which is
enough for the default.

## Docker

A multi-stage build compiles with dev dependencies and ships only production
ones:

```dockerfile [Dockerfile]
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4000
CMD ["node", "--enable-source-maps", "dist/serve.js"]
```

```text [.dockerignore]
node_modules
dist
.env
.env.*
coverage
```

- Run `node` directly in `CMD` (exec form), so `SIGTERM` reaches the app.
- `WORKDIR` matters: it is the working directory Megh resolves paths from.
- Optional integrations are peer dependencies. Anything the app calls in
  production (`@fastify/cors`, `@fastify/swagger`…) must be in
  `dependencies`, not `devDependencies`, or `npm ci --omit=dev` leaves it out
  and the app throws at startup.

## Process managers

Without containers, keep the app running with a process manager.

**PM2**:

```bash
NODE_ENV=production pm2 start dist/serve.js --name api --kill-timeout 15000
```

Set `--kill-timeout` above `shutdownTimeout`; PM2's own default is shorter.

**systemd**:

```ini [/etc/systemd/system/api.service]
[Service]
WorkingDirectory=/srv/api
ExecStart=/usr/bin/node --enable-source-maps dist/serve.js
Environment=NODE_ENV=production
EnvironmentFile=/etc/api.env
Restart=on-failure
User=api

[Install]
WantedBy=multi-user.target
```

systemd sends `SIGTERM` on stop and waits 90 seconds by default.

## Migrations on deploy

Run migrations once per deploy, before the new version takes traffic, for
example as a release step, a Kubernetes `Job` or an init container.

In the runtime image, run the built migrations with `megh migrate
--compiled`. It loads the `.js` files from `dist/` (the tsconfig `outDir`),
so it needs `@meghjs/cli` installed but not the sources or a writable
`node_modules`. Without a `src/` folder this is the default, so plain
`megh migrate` works there too. Set `DATABASE_URL`. See
[Database Commands](/cli/database).

```bash
npx megh migrate --compiled
npx megh migrate:status --compiled
```

Where the sources are available (the build stage, a CI job), `megh migrate`
compiles `src/` with SWC instead.

`megh migrate --seed` and `megh db:seed` refuse to seed when
`NODE_ENV=production` unless you add `--force`.

To migrate without `@meghjs/cli` in the image, compile a small script with
the app. It uses the same connection settings as `useMeghORM()`:

```ts [src/migrate.ts]
import path from 'path';
import { Migrations, createDatabase, resolveDatabaseOptions } from '@meghjs/core';

async function main() {
  const db = createDatabase(resolveDatabaseOptions());
  try {
    const folder = path.join(__dirname, 'database/migrations');
    const ran = await new Migrations(db, { folder }).latest();
    console.log(ran.length ? `Migrated: ${ran.join(', ')}` : 'Nothing to migrate');
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

```bash
node dist/migrate.js
```

## Scheduled tasks and replicas

The scheduler runs in every process that calls `useScheduler`. With three
replicas, or PM2 in cluster mode, each `@Cron` job runs three times. Megh has
no built-in leader election or lock.

Run tasks in one process only, for example a separate deployment with
`RUN_SCHEDULER=true`:

```ts [src/app.ts]
if (process.env.RUN_SCHEDULER === 'true') {
  app.useScheduler([ReportTask, CleanupTask]);
}
```

For work that must happen exactly once, enqueue a job from the task and let a
[queue](/advanced/queue) worker process it. See
[Scheduler](/advanced/scheduler).
