<p align="center">
  <img src="resources/megh-logo.png" alt="MeghJs" width="320" />
</p>

<p align="center"><a href="README.md">English</a> | <b>বাংলা</b></p>

# Megh

![npm version](https://img.shields.io/npm/v/@meghjs/core.svg)
![CI](https://github.com/meghjs/megh/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/npm/l/@meghjs/core.svg)

Megh হলো [Fastify](https://fastify.dev)-এর ওপর তৈরি একটি TypeScript-first web
framework, যা কম boilerplate দিয়ে REST API তৈরির জন্য বানানো। এতে আছে
decorator-based routing, dependency injection, validation, ORM, queue, mail,
scheduling এবং OpenAPI docs, তাই বেশিরভাগ app-এ আর কোনো framework package
লাগে না।

**Documentation: https://meghjs.github.io**

> **আগে এর নাম ছিল Avleon।** `@avleon/*` এখন `@meghjs/*`। দেখুন
> [Moving from Avleon to Megh](https://meghjs.github.io/getting-started/upgrading-megh)।

## সূচিপত্র

- [Quick start](#quick-start)
- [Features](#features)
  - [Core](#core): controller, DI, validation, error, middleware, auth, config
  - [Data](#data): MeghORM, migration, seeding, TypeORM ও Knex
  - [Background work](#background-work): queue, event, scheduling, mail
  - [Web](#web): OpenAPI, file upload, view, WebSocket, caching
  - [Operations](#operations): logging, health check, security, testing
  - [Tooling](#tooling): CLI, scaffolding, AI
- [Packages](#packages)

## Quick start

Megh চালাতে **Node.js 22 বা তার নতুন version** লাগবে। CLI দিয়ে project তৈরি করুন:

```bash
npx @meghjs/cli new myapp
cd myapp
npm run start:dev
```

অথবা আগের কোনো project-এ যোগ করুন:

```bash
npm install @meghjs/core reflect-metadata
```

এবং `tsconfig.json`-এ decorator চালু করুন:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

একটি ছোট app:

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

CORS, OpenAPI, Redis বা Socket.IO-এর মতো integration আলাদা optional package:
যেগুলো ব্যবহার করবেন শুধু সেগুলোই install করুন। পুরো তালিকা দেখুন
[Installation](https://meghjs.github.io/getting-started/installation)-এ।

## Features

### Core

#### Controllers & routing

Decorator দিয়ে route লিখুন, আর parameter decorator দিয়ে param, query, body,
header এবং বর্তমান user পড়ুন।

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

ছোট app-এর জন্য class ছাড়াই route map করা যায়: `app.mapGet("/", () => ({ ok: true }))`।

→ [Controllers](https://meghjs.github.io/core-concept/controller) ·
[Application](https://meghjs.github.io/getting-started/application)

#### Dependency injection

`@AppService` বা `@Injectable` দেওয়া service একবারই তৈরি হয় এবং constructor
দিয়ে inject হয়। Megh নিজের container ব্যবহার করে, কোনো third-party DI library
লাগে না।

→ [Dependency injection](https://meghjs.github.io/core-concept/dependency-injection)

#### Validation

DTO-তে decorator দিন, handler চলার আগেই Megh `@Body()` ও `@Query()` validate
করবে। Decorator-গুলো আসে `@meghjs/core` থেকে, নাম `class-validator`-এর মতোই,
আর গতির জন্য প্রতিটি DTO একবার compile হয়। অজানা property বাতিল হয়, তাই mass
assignment ঠেকানো যায়। Validation ব্যর্থ হলে প্রতিটি field-এর error সহ 400
response যায়।

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

Error response পাঠাতে একটি HTTP exception throw করুন। Exception filter দিয়ে
error কীভাবে response-এ রূপ নেবে তা বদলানো যায়। Development-এর বাইরে 5xx-এর
বিস্তারিত লুকানো থাকে।

```typescript
if (!user) throw HttpExceptions.notFound("User not found");
```

→ [Error handling](https://meghjs.github.io/core-concept/error-handling)

#### Middleware

Middleware চালান প্রতিটি request-এ, একটি controller-এ, বা একটি নির্দিষ্ট
route-এ। Middleware class-গুলো DI দিয়ে তৈরি হয়।

```typescript
@AppMiddleware
class LoggingMiddleware extends MeghMiddleware {
  async invoke(req: IRequest) {
    console.log(`${req.method} ${req.url}`);
    return req;
  }
}

app.useMiddlewares([LoggingMiddleware]);        // প্রতিটি request
@UseMiddleware(LoggingMiddleware)               // একটি controller বা route
```

→ [Middleware](https://meghjs.github.io/core-concept/middleware)

#### Authentication & authorization

Authentication handler ঠিক করে caller কে, এবং `request.user` পূরণ করে।
Authorization deny-by-default: কোনো registered authorizer অনুমতি না দিলে
`@Authorized` route 403 ফেরত দেয়।

```typescript
app.useAuthentication(JwtAuthentication);
app.useAuthorization(RoleAuthorization);

@Authorized({ roles: ["admin"] })
@Get("/stats")
stats(@AuthUser() user: User) { ... }
```

→ [Authentication & authorization](https://meghjs.github.io/core-concept/authentication)

#### Configuration & request context

Config class environment variable-কে typed, injectable setting-এ রূপ দেয়।
প্রতিটি request-এর সাথে একটি `x-request-id` থাকে, যা প্রতিটি log line-এও দেখা
যায়।

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

Megh-এর নিজস্ব ORM: decorator model, relation এবং query builder, যেখানে column
name, value type ও load করা relation TypeScript দিয়ে check হয়। PostgreSQL,
MySQL, SQLite ও SQL Server support করে। শুধু driver install করলেই হবে।

```typescript
@Table("users")
export class User extends Model {
  @PrimaryKey() @AutoIncrement() id?: number;
  @Column({ unique: true }) email!: string;
  @CreatedAt() createdAt?: Date;
  @HasMany(() => Post) posts?: Post[];
}

app.useMeghORM(); // DATABASE_URL পড়ে

const users = await User.where("email", "like", "%@acme.io").with("posts").get();
const ids = await DB.table("users").where("active", true).pluck("id");
```

Timestamp, soft delete, cast, transaction এবং pagination built-in।

→ [MeghORM](https://meghjs.github.io/advanced/orm) ·
[Models](https://meghjs.github.io/advanced/orm/models) ·
[Relations](https://meghjs.github.io/advanced/orm/relations) ·
[Query builder](https://meghjs.github.io/advanced/orm/query-builder)

#### Migrations & seeding

Schema builder দিয়ে migration লিখুন এবং CLI দিয়ে চালান। Factory
[Faker](https://fakerjs.dev)-এর value দিয়ে row পূরণ করে।

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

পরিচিত ORM পছন্দ? [`@meghjs/data`](https://www.npmjs.com/package/@meghjs/data)
install করুন এবং `app.useTypeORM()` বা `app.useKnex()` ব্যবহার করুন। সব
paginator একই `{ data, meta }` আকারে ফল দেয়।

→ [Database](https://meghjs.github.io/advanced/database)

### Background work

#### Queues & workers

[BullMQ](https://docs.bullmq.io)-এর ওপর background job। `@JobHandler` দিয়ে job-এর
নাম দিন, যেকোনো service থেকে dispatch করুন, আর worker চালান একই process-এ বা
আলাদা process-এ। Test ও local development-এ `memory` ও `sync` driver Redis ছাড়াই
job চালায়।

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

Listener সহ typed event। এখনই dispatch করুন, delay ও retry সহ queue-তে পাঠান,
অথবা Socket.IO দিয়ে client-দের কাছে broadcast করুন।

```typescript
class UserCreated extends MeghEvent<{ userId: number }> {}

await dispatcher.dispatch(new UserCreated({ userId: 1 }), { queue: true, retry: 3 });
```

→ [Events](https://meghjs.github.io/advanced/events)

#### Task scheduling

Method চালান cron expression অনুযায়ী, নির্দিষ্ট interval-এ, অথবা startup-এর পর
একবার।

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

Mailable class পাঠান SMTP, SendGrid, Mailgun, Postmark বা Resend দিয়ে, এদের
মধ্যে failover সহ। এখনই পাঠান বা queue থেকে, আর test-এ `Mailer.fake()`
ব্যবহার করুন।

```typescript
await this.mailer.to(user.email).send(new WelcomeMail(user));
await this.mailer.to(user.email).later(60_000, new WelcomeMail(user)); // queue-তে
```

→ [Mail](https://meghjs.github.io/advanced/mail)

### Web

#### OpenAPI

আপনার controller, DTO ও `@Authorized` route থেকে OpenAPI spec তৈরি হয়, এবং
Swagger UI বা [Scalar](https://scalar.com) দিয়ে দেখানো যায়।

```typescript
app.useOpenApi({ info: { title: "My API", version: "1.0.0" }, provider: "scalar" });

@OpenApi({ summary: "List users", tags: ["users"] })
@ApiResponse(200, Paginated(User))
@Get("/")
list(@Query() query: UserQuery) { ... }
```

→ [OpenAPI](https://meghjs.github.io/microservices/openapi)

#### File uploads & static files

`@UploadFile` দিয়ে multipart upload, যা `FileStorage` save করে। Storage
default-ভাবেই নিরাপদ: random file name, অনুমোদিত extension-এর তালিকা,
streaming-এর সময়ই size limit, এবং প্রতিটি path storage folder-এর ভেতরে সীমাবদ্ধ।
`sharp` দিয়ে image resize বা convert করা যায়।

```typescript
@Post("/avatar")
upload(@UploadFile("file") file: MultipartFile) {
  return this.storage.save(file, { to: "avatars" });
}
```

একটি folder serve করুন
`app.useStaticFiles({ root: path.join(process.cwd(), "public"), prefix: "/static/" })` দিয়ে।

→ [File uploads](https://meghjs.github.io/advanced/file-uploads)

#### Views

Layout, include, stack ও `<x-component>` tag সহ Blade-style HTML template।
`@react` দিয়ে React component যোগ করা যায়, যা browser-এ mount হয়।

```typescript
app.useViews({ root: path.join(process.cwd(), "views") });
return Results.View("home", { user }); // views/home.megh.html
```

→ [Views](https://meghjs.github.io/advanced/views)

#### WebSocket

Socket.IO integration। যেকোনো service থেকে `SocketEventDispatcher` দিয়ে message
পাঠান, অথবা domain event broadcast করুন।

```typescript
app.useSocketIo({ cors: { origin: "*" } });
await this.socket.dispatch("users:created", { userId: user.id });
```

→ [WebSocket](https://meghjs.github.io/microservices/websocket)

#### Caching

In-memory বা Redis cache, `CacheManager` হিসেবে inject হয়, TTL এবং সম্পর্কিত
key একসাথে বাতিল করার জন্য tag সহ।

```typescript
await this.cache.set("users:all", users, 3600, ["users"]);
await this.cache.invalidateTags("users");
```

→ [Caching](https://meghjs.github.io/advanced/caching)

### Operations

#### Logging

[pino](https://getpino.io) দিয়ে structured JSON log, development-এ সুন্দর
output সহ। `LoggerService` inject করুন অথবা প্রতিটি module-এর জন্য child logger
তৈরি করুন।

→ [Logging](https://meghjs.github.io/advanced/logging)

#### Health checks & security

`app.useHealth()` যোগ করে `/health` ও `/ready` probe।
`app.useSecurityHeaders()` ও `app.useRateLimit()` app-কে production-এর জন্য
শক্তিশালী করে। `SIGTERM` পেলে `app.run()` সুন্দরভাবে বন্ধ হয়।

→ [Health checks](https://meghjs.github.io/advanced/health) ·
[Security](https://meghjs.github.io/production/security) ·
[Deployment](https://meghjs.github.io/production/deployment)

#### Testing

Dependency সহ একটি controller resolve করুন, অথবা port bind না করেই আসল route
call করুন।

```typescript
const app = MeghTest.createTestApplication({ controllers: [UserController] });

const res = await app.get("/users");
expect(res.statusCode).toBe(200);
```

→ [Testing](https://meghjs.github.io/advanced/testing)

#### Plugins

Route, service ও setup একসাথে plugin হিসেবে package করুন। Install করা Megh
plugin নিজে থেকেই load হয়।

→ [Plugins](https://meghjs.github.io/advanced/plugins)

### Tooling

#### CLI

`megh new` project তৈরি করে। `megh serve` reload সহ চালায়, `megh build` compile
করে, আর `megh start` production-এ চালায়। Generator দিয়ে controller, service,
model, migration, mail ও আরও অনেক কিছু তৈরি করা যায়।

```bash
npx megh make:controller User
npx megh make:resource Ticket --fields "title,body,status:in(open|closed)"
```

→ [CLI](https://meghjs.github.io/cli/basic) ·
[Generators](https://meghjs.github.io/cli/generators)

#### Scaffolding

Template থেকে পুরো feature তৈরি করুন: role ও permission সহ sign-up ও sign-in,
অথবা সম্পূর্ণ business domain।

```bash
npx megh sc:auth --strategy jwt --roles multiple --permissions
npx megh sc:domain ecommerce --resource
```

→ [Scaffolding](https://meghjs.github.io/cli/scaffold/) ·
[Auth](https://meghjs.github.io/cli/scaffold/auth) ·
[RBAC](https://meghjs.github.io/cli/scaffold/rbac) ·
[Domains](https://meghjs.github.io/cli/scaffold/domains)

#### AI

- [`@meghjs/ai`](https://meghjs.github.io/ai/tools) `@Tool()` দিয়ে route-কে LLM
  tool বানায়। প্রতিটি tool call আপনার middleware, authentication, authorization
  ও validation-এর মধ্য দিয়ে যায়।
- [`@meghjs/mcp`](https://meghjs.github.io/ai/mcp) একটি MCP server, যা Claude
  Code, Cursor ও VS Code-এর মতো AI assistant-কে আপনার আসল project ও Megh docs
  দেখায়।

```bash
claude mcp add megh -- npx -y @meghjs/mcp
```

## Packages

| Package                                                      | কাজ                                  |
| ------------------------------------------------------------ | ------------------------------------ |
| [`@meghjs/core`](https://www.npmjs.com/package/@meghjs/core) | Framework                            |
| [`@meghjs/cli`](https://www.npmjs.com/package/@meghjs/cli)   | `megh` command                       |
| [`@meghjs/ai`](https://www.npmjs.com/package/@meghjs/ai)     | Route-কে LLM tool বানায়               |
| [`@meghjs/mcp`](https://www.npmjs.com/package/@meghjs/mcp)   | Megh app তৈরির জন্য MCP server        |
| [`@meghjs/data`](https://www.npmjs.com/package/@meghjs/data) | TypeORM ও Knex integration           |

## Contributing

দেখুন [CONTRIBUTING.md](CONTRIBUTING.md)। নিরাপত্তা-সংক্রান্ত সমস্যা গোপনে
জানান, [SECURITY.md](SECURITY.md)-এ যেভাবে বলা আছে।

## License

MIT © [Tareq Hossain](https://github.com/xtareq)। দেখুন [LICENSE.md](LICENSE.md)।
