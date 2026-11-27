---
title: Introduction
description: What Megh is, who it's for, what it includes and how it compares.
---

# Introduction

Megh is a TypeScript-first web framework for building REST APIs on Node.js.
It runs on [Fastify](https://fastify.dev) and gives you decorators,
dependency injection, validation, an ORM and OpenAPI docs, with less
boilerplate than most structured frameworks.

```ts [controllers/user.controller.ts]
import { ApiController, Get, Post, Param, Body } from '@meghjs/core';
import { UserService } from '../services/user.service';
import { CreateUserDto } from '../dtos/create-user.dto';

@ApiController('/users')
export class UserController {
  constructor(private readonly users: UserService) {}

  @Get('/:id')
  findOne(@Param('id') id: number) {
    return this.users.find(id);
  }

  @Post('/')
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto); // dto is already validated
  }
}
```

```ts [app.ts]
import { Megh } from '@meghjs/core';
import { UserController } from './controllers/user.controller';

const app = Megh.createApplication();
app.useControllers([UserController]);
app.run();
```

The controller gets its service through the constructor, the body is
validated against `CreateUserDto` before the handler runs, and with
`app.useOpenApi()` both routes appear in the generated OpenAPI document.

## Who it's for

- **TypeScript developers who want structure without ceremony.** Controllers,
  services and DTOs, but no module files or provider arrays to keep in sync.
- **Developers coming from Laravel, Rails or Django** who miss models,
  migrations, seeders and generators in Node.
- **Teams building business APIs**, where the CLI can scaffold a working
  domain with auth and roles in minutes.

## What's included

**HTTP**
- Decorator-based [controllers](/core-concept/controller) and inline routes
- [Middleware](/core-concept/middleware) with one fixed pipeline order
- [Validation](/core-concept/validation) with class-validator-compatible
  decorators, compiled once per DTO
- [Authentication](/core-concept/authentication) and deny-by-default
  authorization
- [Error handling](/core-concept/error-handling) with exception filters
- [OpenAPI](/microservices/openapi) documents with Swagger UI or Scalar

**Application**
- [Dependency injection](/core-concept/dependency-injection) with Megh's own
  container
- [Configuration](/core-concept/configuration) from `.env` and typed config
  classes
- [Lifecycle hooks](/getting-started/application#lifecycle-hooks) and
  graceful shutdown
- [Health checks](/advanced/health), request IDs and
  [structured logging](/advanced/logging)

**Data and background work**
- [MeghORM](/advanced/orm): typed models, a query builder, migrations,
  seeders and factories
- Optional [TypeORM and Knex](/advanced/database) integrations through
  `@meghjs/data`
- [Events](/advanced/events), [queues](/advanced/queue),
  [scheduled tasks](/advanced/scheduler) and [caching](/advanced/caching)
- [File uploads](/advanced/file-uploads) with safe defaults
- [WebSockets](/microservices/websocket) with Socket.IO

**Tooling**
- The [`megh` CLI](/cli/basic): new projects, generators, migrations and
  [scaffolding](/cli/scaffold/)
- [Testing helpers](/advanced/testing) and in-memory queue drivers

## How it's built

- **On Fastify.** Megh adds structure on top of Fastify rather than replacing
  it. Any Fastify plugin works through `app.registerFastifyPlugin()`.
- **Install only what you use.** Integrations such as CORS, OpenAPI, uploads,
  Redis and Socket.IO are optional peer dependencies. If one is missing, the
  `use*` call tells you what to install.
- **Safe defaults.** `@Authorized` routes are denied unless an authorization
  handler allows them, fields a DTO doesn't declare are rejected with a 400,
  5xx details are hidden in production, and uploads get random names inside
  a fixed folder.
- **CommonJS.** `@meghjs/core` ships one CommonJS build, which ESM projects
  can still import. See [Installation](/getting-started/installation).

## How it compares

- **Express and Fastify** give you routing and leave structure to you. Megh
  adds controllers, DI, validation, an ORM and OpenAPI, on Fastify.
- **NestJS** is the closest in style: decorators, DI and controllers. Megh
  has no module system, so there's less wiring, and it ships its own ORM and
  scaffolding. NestJS has a much larger ecosystem and community.
- **AdonisJS** shares the batteries-included idea. Megh is decorator-first and
  runs on Fastify.

## Project status

Megh is in `0.x` and heading to 1.0. Minor releases can still contain
breaking changes, each with an upgrade guide. See the
[versioning policy](/reference/versioning) and
[upcoming changes](/getting-started/upgrading-next).

> **On 0.5.x?** See [Upgrading to 0.6](/getting-started/upgrading-0.6).

> **Coming from Avleon?** Avleon is now Megh. See
> [Moving from Avleon to Megh](/getting-started/upgrading-megh). On 0.3 or
> earlier, read [Upgrading to 0.4](/getting-started/upgrading-0.4) first.

## Next steps

1. [Install Megh](/getting-started/installation) and create a project.
2. Follow the [Quick Start](/getting-started/usage) to write your first routes.
3. Read [Application](/getting-started/application) to see how an app is
   put together.
