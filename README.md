<p align="center">
  <img src="resources/megh-logo.png" alt="MeghJs" width="320" />
</p>

<p align="center"><b>English</b> | <a href="README.bn.md">বাংলা</a></p>

# Megh

![npm version](https://img.shields.io/npm/v/@meghjs/core.svg)
![CI](https://github.com/meghjs/megh/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/npm/l/@meghjs/core.svg)

Megh is a TypeScript-first web framework built on [Fastify](https://fastify.dev)
for building REST APIs with minimal boilerplate. It comes with decorator-based
routing, dependency injection, validation, an ORM, queues, mail, scheduling and
OpenAPI docs, so most apps need no other framework packages.

**Documentation: https://meghjs.github.io**

> **Formerly Avleon.** `@avleon/*` is now `@meghjs/*`. See
> [Moving from Avleon to Megh](https://meghjs.github.io/getting-started/upgrading-megh).

## Contents

- [Quick start](#quick-start)
- [Features](#features)
  - [Core](#core): controllers, DI, validation, errors, middleware, auth, config
  - [Data](#data): MeghORM, migrations, seeding, TypeORM and Knex
  - [Background work](#background-work): queues, events, scheduling, mail
  - [Web](#web): OpenAPI, file uploads, views, WebSocket, caching
  - [Operations](#operations): logging, health checks, security, testing
  - [Tooling](#tooling): CLI, scaffolding, AI
- [Packages](#packages)

## Quick start

Megh requires **Node.js 22 or newer**. Create a project with the CLI:

```bash
npx @meghjs/cli new myapp
cd myapp
npm run start:dev
```

Or add it to an existing project:

```bash
npm install @meghjs/core reflect-metadata
```

and enable decorators in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

A minimal app:

```typescript
import { Megh, ApiController, Get } from "@meghjs/core";

@ApiController("/")
class HelloController {
  @Get()
  sayHello() {
    return { message: "Hello, Megh!" };
  }
}

const app = Megh.createApplication();
app.useControllers([HelloController]);
app.run(4000);
```

Integrations such as CORS, OpenAPI, Redis or Socket.IO are optional packages:
install only the ones you use. See
[Installation](https://meghjs.github.io/getting-started/installation) for the
full list.

## Features

### Core

#### Controllers & routing

Define routes with decorators, and read params, query, body, headers and the
current user with parameter decorators.

```typescript
@ApiController("/users")
class UserController {
  constructor(private readonly users: UserService) {}

  @Get("/:id")
  find(@Param("id") id: string) {
    return this.users.find(id);
  }

  @Post("/")
  create(@Body() body: CreateUserDto) {
    return this.users.create(body);
  }
}
```

For small apps, map routes without a class: `app.mapGet("/", () => ({ ok: true }))`.

→ [Controllers](https://meghjs.github.io/core-concept/controller) ·
[Application](https://meghjs.github.io/getting-started/application)

#### Dependency injection

Services marked `@AppService` or `@Injectable` are created once and injected
through constructors. Megh uses its own container, with no third-party DI
library.

→ [Dependency injection](https://meghjs.github.io/core-concept/dependency-injection)

#### Validation

Decorate a DTO and Megh validates `@Body()` and `@Query()` before your handler
runs. The decorators come from `@meghjs/core`, with the same names as
`class-validator`, and are compiled once per DTO for speed. Unknown properties
are rejected, which prevents mass assignment. A failed request gets a 400 with
the errors per field.

```typescript
import { IsEmail, IsInt, IsString, Min } from "@meghjs/core";

class CreateUserDto {
  @IsString() name: string;
  @IsEmail() email: string;
  @IsInt() @Min(18) age: number;
}
```

→ [Validation](https://meghjs.github.io/core-concept/validation)

#### Error handling

Throw an HTTP exception to send an error response. Exception filters let you
change how errors are turned into responses. Outside development, 5xx details
are hidden.

```typescript
if (!user) throw HttpExceptions.notFound("User not found");
```

→ [Error handling](https://meghjs.github.io/core-concept/error-handling)

#### Middleware

Run middleware on every request, on a controller or on a single route.
Middleware classes are resolved through DI.

```typescript
@AppMiddleware
class LoggingMiddleware extends MeghMiddleware {
  async invoke(req: IRequest) {
    console.log(`${req.method} ${req.url}`);
    return req;
  }
}

app.useMiddlewares([LoggingMiddleware]);        // every request
@UseMiddleware(LoggingMiddleware)               // a controller or route
```

→ [Middleware](https://meghjs.github.io/core-concept/middleware)

#### Authentication & authorization

An authentication handler decides who the caller is and fills `request.user`.
Authorization is deny-by-default: an `@Authorized` route returns 403 unless a
registered authorizer allows the request.

```typescript
app.useAuthentication(JwtAuthentication);
app.useAuthorization(RoleAuthorization);

@Authorized({ roles: ["admin"] })
@Get("/stats")
stats(@AuthUser() user: User) { ... }
```

→ [Authentication & authorization](https://meghjs.github.io/core-concept/authentication)

#### Configuration & request context

Config classes turn environment variables into typed, injectable settings.
Every request carries an `x-request-id`, which also appears in each log line.

```typescript
@AppConfig
export class MailConfig extends MeghConfig<{ host: string; port: number }> {
  config(env: Environment) {
    return { host: env.get("MAIL_HOST") || "localhost", port: Number(env.get("MAIL_PORT")) || 1025 };
  }
}
```

→ [Configuration](https://meghjs.github.io/core-concept/configuration) ·
[Request context](https://meghjs.github.io/core-concept/request-context)

### Data

#### MeghORM

Megh's own ORM: decorator models, relations and a query builder, with column
names, value types and loaded relations checked by TypeScript. It supports
PostgreSQL, MySQL, SQLite and SQL Server. Install only the driver.

```typescript
@Table("users")
export class User extends Model {
  @PrimaryKey() @AutoIncrement() id?: number;
  @Column({ unique: true }) email!: string;
  @CreatedAt() createdAt?: Date;
  @HasMany(() => Post) posts?: Post[];
}

app.useMeghORM(); // reads DATABASE_URL

const users = await User.where("email", "like", "%@acme.io").with("posts").get();
const ids = await DB.table("users").where("active", true).pluck("id");
```

Timestamps, soft deletes, casts, transactions and pagination are built in.

→ [MeghORM](https://meghjs.github.io/advanced/orm) ·
[Models](https://meghjs.github.io/advanced/orm/models) ·
[Relations](https://meghjs.github.io/advanced/orm/relations) ·
[Query builder](https://meghjs.github.io/advanced/orm/query-builder)

#### Migrations & seeding

Write migrations with a schema builder and run them from the CLI. Factories fill
rows with [Faker](https://fakerjs.dev) values.

```bash
npx megh make:migration create_users_table
npx megh make:factory user
npx megh make:seeder users
npx megh migrate --seed
```

→ [Migrations](https://meghjs.github.io/advanced/orm/migrations) ·
[Seeding](https://meghjs.github.io/advanced/orm/seeding) ·
[Database CLI](https://meghjs.github.io/cli/database)

#### TypeORM & Knex

Prefer an existing ORM? Install [`@meghjs/data`](https://www.npmjs.com/package/@meghjs/data)
and use `app.useTypeORM()` or `app.useKnex()`. All paginators return the same
`{ data, meta }` shape.

→ [Database](https://meghjs.github.io/advanced/database)

### Background work

#### Queues & workers

Background jobs on [BullMQ](https://docs.bullmq.io). Name jobs with
`@JobHandler`, dispatch them from any service, and run workers in the same
process or a separate one. The `memory` and `sync` drivers run jobs without Redis
in tests and local development.

```typescript
@Queue({ name: "email" })
export class EmailQueue extends MeghQueue<{ email: string }> {
  constructor() {
    super();
  }

  @JobHandler("welcome")
  async sendWelcome(job: Job<{ email: string }>) { ... }
}

await emailQueue.dispatch("welcome", { email: user.email });
```

→ [Queues & workers](https://meghjs.github.io/advanced/queue)

#### Events

Typed events with listeners. Dispatch them now, queue them with delay and retry,
or broadcast them to clients over Socket.IO.

```typescript
class UserCreated extends MeghEvent<{ userId: number }> {}

await dispatcher.dispatch(new UserCreated({ userId: 1 }), { queue: true, retry: 3 });
```

→ [Events](https://meghjs.github.io/advanced/events)

#### Task scheduling

Run methods on a cron expression, an interval, or once after startup.

```typescript
@ScheduledTask()
export class ReportTask {
  @Cron("0 8 * * 1-5", { timezone: "Asia/Dhaka" })
  async sendDailyReport() { ... }

  @Interval(60_000)
  async poll() { ... }
}

app.useScheduler([ReportTask]);
```

→ [Task scheduling](https://meghjs.github.io/advanced/scheduler)

#### Mail

Mailable classes sent over SMTP, SendGrid, Mailgun, Postmark or Resend, with
failover between them. Send now or from a queue, and use `Mailer.fake()` in tests.

```typescript
await this.mailer.to(user.email).send(new WelcomeMail(user));
await this.mailer.to(user.email).later(60_000, new WelcomeMail(user)); // queued
```

→ [Mail](https://meghjs.github.io/advanced/mail)

### Web

#### OpenAPI

Generate an OpenAPI spec from your controllers, DTOs and `@Authorized` routes,
and serve it with Swagger UI or [Scalar](https://scalar.com).

```typescript
app.useOpenApi({ info: { title: "My API", version: "1.0.0" }, provider: "scalar" });

@OpenApi({ summary: "List users", tags: ["users"] })
@ApiResponse(200, Paginated(User))
@Get("/")
list(@Query() query: UserQuery) { ... }
```

→ [OpenAPI](https://meghjs.github.io/microservices/openapi)

#### File uploads & static files

Multipart uploads with `@UploadFile`, saved by `FileStorage`. Storage is safe by
default: random file names, an allow-list of extensions, a size limit enforced
while streaming, and every path confined to the storage folder. Images can be
resized or converted with `sharp`.

```typescript
@Post("/avatar")
upload(@UploadFile("file") file: MultipartFile) {
  return this.storage.save(file, { to: "avatars" });
}
```

Serve a folder with
`app.useStaticFiles({ root: path.join(process.cwd(), "public"), prefix: "/static/" })`.

→ [File uploads](https://meghjs.github.io/advanced/file-uploads)

#### Views

Blade-style HTML templates with layouts, includes, stacks and `<x-component>`
tags. `@react` embeds React components that mount in the browser.

```typescript
app.useViews({ root: path.join(process.cwd(), "views") });
return Results.View("home", { user }); // views/home.megh.html
```

→ [Views](https://meghjs.github.io/advanced/views)

#### WebSocket

Socket.IO integration. Push messages from any service with
`SocketEventDispatcher`, or broadcast domain events.

```typescript
app.useSocketIo({ cors: { origin: "*" } });
await this.socket.dispatch("users:created", { userId: user.id });
```

→ [WebSocket](https://meghjs.github.io/microservices/websocket)

#### Caching

In-memory or Redis cache, injected as `CacheManager`, with TTLs and tags for
invalidating related keys together.

```typescript
await this.cache.set("users:all", users, 3600, ["users"]);
await this.cache.invalidateTags("users");
```

→ [Caching](https://meghjs.github.io/advanced/caching)

### Operations

#### Logging

Structured JSON logs via [pino](https://getpino.io), with pretty output in
development. Inject `LoggerService` or create child loggers per module.

→ [Logging](https://meghjs.github.io/advanced/logging)

#### Health checks & security

`app.useHealth()` adds `/health` and `/ready` probes.
`app.useSecurityHeaders()` and `app.useRateLimit()` harden the app for
production. `app.run()` shuts down gracefully on `SIGTERM`.

→ [Health checks](https://meghjs.github.io/advanced/health) ·
[Security](https://meghjs.github.io/production/security) ·
[Deployment](https://meghjs.github.io/production/deployment)

#### Testing

Resolve a controller with its dependencies, or call real routes without
binding a port.

```typescript
const app = MeghTest.createTestApplication({ controllers: [UserController] });

const res = await app.get("/users");
expect(res.statusCode).toBe(200);
```

→ [Testing](https://meghjs.github.io/advanced/testing)

#### Plugins

Package routes, services and setup as a plugin. Installed Megh plugins load
automatically.

→ [Plugins](https://meghjs.github.io/advanced/plugins)

### Tooling

#### CLI

`megh new` creates a project. `megh serve` runs it with reload,
`megh build` compiles it and `megh start` runs it in production. Generators
create controllers, services, models, migrations, mail and more.

```bash
npx megh make:controller User
npx megh make:resource Ticket --fields "title,body,status:in(open|closed)"
```

→ [CLI](https://meghjs.github.io/cli/basic) ·
[Generators](https://meghjs.github.io/cli/generators)

#### Scaffolding

Generate whole features from templates: sign-up and sign-in with roles and
permissions, or complete business domains.

```bash
npx megh sc:auth --strategy jwt --roles multiple --permissions
npx megh sc:domain ecommerce --resource
```

→ [Scaffolding](https://meghjs.github.io/cli/scaffold/) ·
[Auth](https://meghjs.github.io/cli/scaffold/auth) ·
[RBAC](https://meghjs.github.io/cli/scaffold/rbac) ·
[Domains](https://meghjs.github.io/cli/scaffold/domains)

#### AI

- [`@meghjs/ai`](https://meghjs.github.io/ai/tools) turns routes into LLM tools
  with `@Tool()`. Every tool call runs through your middleware, authentication,
  authorization and validation.
- [`@meghjs/mcp`](https://meghjs.github.io/ai/mcp) is an MCP server that gives
  AI assistants such as Claude Code, Cursor and VS Code your real project and
  the Megh docs.

```bash
claude mcp add megh -- npx -y @meghjs/mcp
```

## Packages

| Package                                                      | Purpose                              |
| ------------------------------------------------------------ | ------------------------------------ |
| [`@meghjs/core`](https://www.npmjs.com/package/@meghjs/core) | The framework                        |
| [`@meghjs/cli`](https://www.npmjs.com/package/@meghjs/cli)   | The `megh` command                   |
| [`@meghjs/ai`](https://www.npmjs.com/package/@meghjs/ai)     | Routes as LLM tools                  |
| [`@meghjs/mcp`](https://www.npmjs.com/package/@meghjs/mcp)   | MCP server for building Megh apps    |
| [`@meghjs/data`](https://www.npmjs.com/package/@meghjs/data) | TypeORM and Knex integrations        |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately, as
described in [SECURITY.md](SECURITY.md).

## License

MIT © [Tareq Hossain](https://github.com/xtareq). See [LICENSE.md](LICENSE.md).
