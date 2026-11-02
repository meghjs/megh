---
title: Installation
description: Megh installation
---

# Installation

Megh requires **Node.js 22 or newer**.

## Using Cli

If you already installed @meghjs/cli globally then run the following command:

```sh
megh new myapi
```

else you can install using npx:

::: code-group
```sh [npm]
npx @meghjs/cli new myapi
```
```sh [pnpm]
pnpm dlx @meghjs/cli new myapi
```
```sh [yarn]
yarn dlx @meghjs/cli new myapi
```
:::

The CLI asks which package manager to use and which features to include —
OpenAPI docs, CORS, TypeORM, Knex and Scalar UI — then scaffolds the project and
installs its dependencies.

```sh
cd myapi
npm run start:dev
```

The app starts on `http://localhost:4000`, and with OpenAPI enabled the docs are
served at `/docs`.

### What you get

```
myapi/
├── src/
│   ├── controllers/     # Route controllers
│   ├── services/        # Business logic
│   ├── config/          # App configuration
│   ├── app.ts           # App setup
│   └── serve.ts         # Entry point
├── test/
├── tsconfig.json
└── package.json
```

| Script | Description |
|--------|-------------|
| `start:dev` | Start the dev server with hot reload |
| `build` | Compile TypeScript to JavaScript |
| `start` | Start the production server |
| `test` | Run unit tests |

## Manual

Go to your desired project directory and run the following commands:

::: code-group
```sh [Bash]
mkdir myapi && cd myapi &&  mkdir src 
```
```powershell [Powershell]
New-Item -ItemType Directory -Name myapi
Set-Location myapi
New-Item -ItemType Directory -Name src

```
:::

::: code-group
```sh [npm]
npm init -y
npm i @meghjs/core reflect-metadata class-validator class-transformer
npm i --save-dev typescript @types/node
npx tsc --init
```
```sh [pnpm]
pnpm init
pnpm i @meghjs/core reflect-metadata class-validator class-transformer
pnpm i --save-dev typescript @types/node
pnpm tsc --init
```
```sh [yarn]
yarn init -y
yarn add @meghjs/core reflect-metadata class-validator class-transformer
yarn add --dev typescript @types/node
yarn tsc --init
```
:::

Since 0.3, `class-validator` and `class-transformer` are peer dependencies. The
package loads them at import time, so install them in every project.

Ensure `experimentalDecorators` and `emitDecoratorMetadata` are enabled in
tsconfig.json — Megh's decorators do not work without them.

```json{3-4}
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

Then add a minimal entry point:

```ts [src/app.ts]
import { Megh } from '@meghjs/core';

const app = Megh.createApplication();

app.mapGet('/', () => 'Welcome to Megh.');

app.run();
```

You can still use the CLI's generators and dev server in a manually created
project by installing it locally:

```sh
npm i -D @meghjs/cli
npx megh serve
```

## Optional dependencies

Install these only for the features you use. Without them the package still
imports, and you get a clear install hint the moment a feature needs one:

| Feature | Package |
|---------|---------|
| CORS (`useCors`) | `@fastify/cors` |
| File uploads (`useMultipart`, `@UploadFile`) | `@fastify/multipart` |
| Static files (`useStaticFiles`) | `@fastify/static` |
| OpenAPI with Swagger UI | `@fastify/swagger`, `@fastify/swagger-ui` |
| OpenAPI with Scalar | `@fastify/swagger`, `@scalar/fastify-api-reference` |
| Models and migrations (`useDatabase`) | `kysely` + a driver (`pg`, `mysql2`, `better-sqlite3`) |
| TypeORM | `typeorm` + a driver (`pg`, `mysql2`, `sqlite3`, `better-sqlite3`, `mssql`) |
| Knex | `knex` + a driver |
| Queues | `bullmq`, `ioredis` (not needed with the `memory`/`sync` drivers) |
| Redis cache | `ioredis` |
| Websockets | `socket.io`, `fastify-socket.io` |
| Image transforms | `sharp` |
| Pretty dev logs | `pino-pretty` (dev dependency) |

## Module format

`@meghjs/core` ships a single CommonJS build. ESM projects can still
`import { ... } from '@meghjs/core'`. Only the package root is exported:
deep imports such as `@meghjs/core/dist/...` are not supported.
