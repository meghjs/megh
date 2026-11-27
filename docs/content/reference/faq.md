---
title: FAQ and Troubleshooting
description: Answers to common questions and fixes for the problems people hit most often.
---

# FAQ and Troubleshooting

Start with `megh doctor` when something looks wrong. It checks the Node
version, that `@meghjs/core` matches the CLI, that `reflect-metadata` is
installed and that both decorator flags are on in `tsconfig.json`.

```bash
npx megh doctor
```

## Troubleshooting

### DTOs aren't validated, or injected services are `undefined`

Megh reads TypeScript's decorator metadata (`design:paramtypes`) to find
constructor dependencies and the DTO class of a `@Body()` or `@Query()`
parameter. Without it, a `@Body()` or `@Query()` without `{ type }` stops
startup with `@Body() (parameter 0) has no type, because decorator metadata
wasn't emitted`. Constructor parameters are `undefined`, so you may also see
`TypeError: Cannot read properties of undefined` in a handler.

Turn both flags on:

```json [tsconfig.json]
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

Then check the compiler. `tsc`, `megh serve` and `megh build` emit the
metadata. **tsx and esbuild don't**, and SWC only does with
`jsc.transform.decoratorMetadata: true`. If you must use one of them, name
the types yourself:

```ts
import { ApiController, Post, Body, inject } from '@meghjs/core';

@ApiController('/users')
export class UserController {
  private readonly users = inject(UserService); // instead of a constructor parameter

  @Post('/')
  create(@Body({ type: CreateUserDto }) dto: CreateUserDto) {
    return this.users.create(dto);
  }
}
```

### Do I need `import 'reflect-metadata'`?

Usually not. `@meghjs/core` imports it on load. Add it as the first line of
your entry file only if classes decorated by other libraries (a DTO that only
uses `class-validator`, say) can be loaded before anything imports
`@meghjs/core`. TypeScript drops the metadata silently when
`Reflect.metadata` doesn't exist yet.

```ts [src/serve.ts]
import 'reflect-metadata';
import app from './app';
```

### ESM or CommonJS?

`@meghjs/core` ships a single CommonJS build. ESM projects can import it, but
the CLI (`serve`, `build`, `start`) and the scaffold assume a CommonJS app:
`"module": "CommonJS"` in `tsconfig.json` and no `"type": "module"` in
`package.json`. If you add `"type": "module"`, Node loads the compiled
CommonJS files as ES modules and stops with
`ReferenceError: exports is not defined in ES module scope`. Remove it, or
compile and run the app yourself as real ESM.

### `Cannot access 'User' before initialization` between models

This happens only in ES module builds, when two models import each other and
a relation field is typed with the bare model:

```ts
@BelongsTo(() => User)
author?: User;              // breaks in ESM when User imports Post
author?: User | null;       // fine
author?: BelongsTo<User>;   // fine
```

Keep `| null` on `@HasOne` and `@BelongsTo` fields, or use the `HasOne<…>` /
`BelongsTo<…>` types. CommonJS builds are not affected. See
[Relations](/advanced/orm/relations).

### `[Megh] … is not installed`

Integrations are optional peer dependencies, loaded when the app sets up the
feature (for most, when you call its `use*` method). The error names the
command to run:

```text
[Megh] fastify-socket.io is not installed.
Run: npm install fastify-socket.io socket.io
```

The same applies to `@fastify/cors`, `@fastify/multipart`, `@fastify/static`,
`@fastify/swagger`, `@fastify/swagger-ui` and
`@scalar/fastify-api-reference`. Database drivers fail with
`The postgres connection needs "pg". Install it: npm install pg`.

If it works locally but fails in production, the package is probably in
`devDependencies` and was left out by `npm ci --omit=dev`. Move it to
`dependencies`, or only call that `use*` method in development.

### Every `@Authorized` route answers 403

No authorization handler is registered. Megh denies those routes instead of
serving them, and logs this at startup:

```text
GET /users uses @Authorized but no authorization handler is registered;
every request will be denied (403). Call app.useAuthorization(YourAuthorization).
```

Register one with `app.useAuthorization(AppAuthorization)`. If you have one,
check that it doesn't return `false` (that is a 403 too) and that
`useAuthentication` is set, so `request.user` is filled in. See
[Authentication](/core-concept/authentication).

### Auto-discovered controllers aren't found

`useControllers({ auto: true })` scans every `controllers/` folder under
`src/` (`src/controllers/`, `src/users/controllers/`). When TypeScript runs
directly (ts-node, tsx, `node --experimental-strip-types src/serve.ts`) it
loads the `.ts` files from `src`. Otherwise it loads the compiled `.js`
files: it reads `rootDir` and `outDir` from `tsconfig.build.json` or
`tsconfig.json` (defaults `src` and `dist`) and also tries the nested
`dist/src/controllers` when `rootDir` isn't set. Paths are relative to the
current working directory. Routes go missing when:

- **The app wasn't built**, so the compiled folder doesn't exist yet.
- **The tsconfig isn't in the working directory**, or `outDir` comes from a
  package `extends` (only relative `extends` are followed). Pass the
  compiled folder: `useControllers({ auto: true, path: 'build/controllers' })`.
- **The app starts from another directory.** Start it from the project root.

When the folder doesn't exist, Megh logs `Could not auto-register
controllers` with the folder it tried. A file in it that fails to import
stops startup with the file name and the error. Passing a list,
`useControllers([UserController, ...])`, avoids all of this.

### `EADDRINUSE: address already in use`

Another process is listening on the port, often an old dev server. Stop it,
or pick another port:

```bash
PORT=4001 npm run start:dev
```

Find the process with `lsof -i :4000` (macOS, Linux) or
`netstat -ano | findstr :4000` (Windows). `app.run()` uses `PORT`, else
`4000`, unless you pass a port.

### `.env` isn't loaded

- Megh loads `.env` from the **current working directory** when
  `@meghjs/core` is first imported. Start the app from the project root.
- Variables already in the environment win over `.env`.
- `MEGH_DOTENV=false` turns loading off.
- Code that reads `process.env` before importing `@meghjs/core` runs before
  `.env` is loaded. Read config through `Environment` or after the import.
- Only `.env` is read. Megh doesn't load `.env.local` or `.env.production`.

See [Configuration](/core-concept/configuration).

### Detailed errors show up in production

`NODE_ENV` is `development` there, often from a `.env` file copied with the
app. Set `NODE_ENV=production` in the real environment and don't ship `.env`.
See [Deployment](/production/deployment#environment).

### Scheduled jobs run more than once

Each replica runs the scheduler. Start it in one process only. See
[Deployment](/production/deployment#scheduled-tasks-and-replicas).

## FAQ

### Is Megh production ready?

Megh runs on Fastify and has the pieces production needs: graceful shutdown,
health checks, structured logs and safe error responses. It is still `0.x`,
so a minor release can contain breaking changes, each with an upgrade guide.
Pin the version and read the guide before upgrading. See
[Deployment](/production/deployment) and
[Security Hardening](/production/security).

### How does Megh compare to NestJS?

Both use decorators, dependency injection and controllers. Megh runs on
Fastify only and has no module system: classes marked `@Injectable` or
`@AppService` are available everywhere, with no provider arrays to keep in
sync. It ships its own ORM, migrations, scaffolding and CLI generators.
NestJS supports Express and Fastify, has a module system for large codebases
and a much larger ecosystem and community.

### Can I use Fastify plugins?

Yes. Register them with `registerFastifyPlugin()`:

```ts
import etag from '@fastify/etag';

app.registerFastifyPlugin(etag);
```

Call it before `run()` or inside an `onInit()` hook. Some plugins attach
themselves to each route as it is added; Megh loads registered plugins before
it adds routes, so they see every controller and inline route. Compression
is built in with `useCompression()`. Security headers and rate limits are built in:
see [Security Hardening](/production/security#add-security-headers).
To package your own features as `use*` methods, write a
[Megh plugin](/advanced/plugins).
