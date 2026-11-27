---
title: Upgrading to 0.7
description: "What changes in Megh 0.7.3, 0.7.2, 0.7.1 and 0.7.0: sessions, gates and @auth/@can view directives, editor support for templates, LLM tools and an MCP server for your app (@meghjs/ai), AGENTS.md and llms.txt for coding agents, optional class-validator and class-transformer, a fuller ORM (constrained eager loading, upserts, model events, hidden columns, polymorphic relations), server-rendered views, the @meghjs/mcp server, deny-by-default authorization and the request context API."
---

# Upgrading to 0.7

The `@meghjs` packages share one version number. Upgrade them together:

```sh
npm i @meghjs/core@~0.7.3
npm i -D @meghjs/cli@~0.7.3
npm i @meghjs/ai@~0.7.3   # optional: LLM tools and an MCP server for your app
```

0.7.3 adds [sessions](/advanced/sessions) for server-rendered apps, with a
login redirect, gates and the `@auth`, `@guest`, `@can` and `@session` view
directives, and [editor support](/advanced/views#editor-setup) for `.megh.html`
templates in VS Code, Neovim and other LSP editors. See
[New in 0.7.3](#new-in-0-7-3).

It has one breaking change: `app.app`, the Fastify instance, is no longer
public. Read [Breaking in 0.7.3](#breaking-in-0-7-3) if your code uses it.

`@meghjs/data` is not part of 0.7.3. It stays at 0.7.2, which works with
`@meghjs/core` 0.7.3.

Coming from 0.7.1? 0.7.2 adds [`@meghjs/ai`](/ai/tools), which turns routes
into LLM tools and serves them over MCP, and gives coding agents an
`AGENTS.md` in new projects and [`/llms.txt`](https://meghjs.github.io/llms.txt)
for the docs. It has no breaking changes. See [New in 0.7.2](#new-in-0-7-2).

Coming from 0.7.0? 0.7.1 makes class-validator and class-transformer optional and fills out the
[ORM](/advanced/orm). It has a few breaking changes, which is unusual for a
patch release: read [Breaking in 0.7.1](#breaking-in-0-7-1) before upgrading.
Each item says how to tell whether it affects you.

Coming from 0.6.x? Read [Breaking in 0.7.0](#breaking-in-0-7-0) too.

0.7 is the last minor release before 1.0. See the
[versioning policy](/reference/versioning).

## Breaking in 0.7.3

### The Fastify instance is no longer public

`app.app` is gone. Megh keeps the Fastify instance to itself, so an app can't
change routing, hooks or error handling behind Megh's back.

**Affects you if** your code or tests use `app.app`. Replace each use:

| Before                            | After                                     |
| --------------------------------- | ----------------------------------------- |
| `app.app.register(plugin, opts)`  | `app.registerFastifyPlugin(plugin, opts)` |
| `app.app.inject({ method, url })` | `app.inject({ method, url })`             |
| `app.app.server.address()`        | `app.address()`                           |
| `app.app.close()`                 | `app.close()`                             |

`registerFastifyPlugin()` works before `run()` and inside `onInit()` hooks.
Megh loads the plugins before it adds routes, so plugins that hook into
routes see all of them. It throws once routes are mapped. Megh
[plugins](/advanced/plugins) still get the instance as `ctx.http`. See
[Fastify plugins](/getting-started/application#fastify-plugins).

## New in 0.7.3

### Sessions

[`app.useSession()`](/advanced/sessions) adds cookie sessions. The cookie
holds a random ID, signed with HMAC-SHA256, and the data stays on the server:
in memory, in Redis (`redis: new Redis()`), or in your own `SessionStore`.

- Inject the session with `@Session()`, or read it with `currentSession()`.
  Views get it as `session`.
- `flash()` keeps a value for the next request only, for messages after a
  redirect.
- Call `regenerate()` on login and `destroy()` on logout.
- `secret` defaults to `SESSION_SECRET` and must be at least 32 characters.
  An array of secrets rotates keys.

There are no new dependencies.

### Login redirect

With `useSession({ loginPath: "/login" })`, a browser that hits a route
needing a logged-in user is redirected to the login page instead of getting a
401. A GET remembers its URL, and `session.intended("/")` sends the user back
there after login. JSON and XHR requests keep the 401. See
[Protecting pages](/advanced/sessions#protecting-pages).

### Gates

`app.defineGate(name, check)` defines a permission check for the logged-in
user. Use it in code with `gate.allows()`, `gate.denies()` and
`gate.authorize()` (401 for a guest, 403 when denied), and in views with
`@can`. See [Gates](/advanced/sessions#gates).

### View directives

- `@auth` … `@endauth` and `@guest` … `@endguest`: logged in or not, from
  `useAuthentication()`.
- `@can('edit-post', post)` … `@endcan` and `@cannot(...)` … `@endcannot`:
  gate checks.
- `@session('status')` … `{{ value }}` … `@endsession`: a session value, such
  as a flashed message.

All of them except `@session` take `@else`. See [Views](/advanced/views#syntax).

### Editor support for templates

[Editor setup](/advanced/views#editor-setup) covers the VS Code extension, the new
Neovim plugin ([`megh.nvim`](https://github.com/meghjs/megh.nvim)), and the
Megh language server for other LSP editors. They give highlighting,
completion, hover, formatting and validation for `.megh.html` files. Typing
`@` now completes directives, and block directives are inserted with their
closing tag.

### Other changes

- `app.inject()` sends a request to the app in-process, for tests.
  `app.address()` returns the address the server listens on, for example
  after `run(0)`.
- `megh new --pm pnpm` writes a `pnpm-workspace.yaml` that approves the build
  scripts the project needs (`@swc/core`, and `better-sqlite3` for an ORM app
  on SQLite). Without it, pnpm 10 skips building `better-sqlite3` and the app
  crashes on its first query, and pnpm 12 fails the install.

## New in 0.7.2

### LLM tools and an MCP server: `@meghjs/ai`

[`@meghjs/ai`](/ai/tools) is a new plugin. Install it to use it; nothing
changes for apps that don't.

- `@Tool()` exposes a route to LLMs as a tool. Its input schema comes from the
  route's path parameters, `@Query()` and `@Body()` DTO, and each call goes
  through the route's authentication, `@Authorized`, validation and rate
  limits.
- `app.tools()`, or an injected `ToolSet`, gives the tools in Anthropic,
  OpenAI or MCP format, and runs a model's tool calls as the signed-in user.
  `confirm: true` tools need a person's approval.
- `app.useMcp()` serves the tools as an MCP server over Streamable HTTP, so
  assistants such as Claude or Cursor can use your app with the permissions of
  the user who connects them. It needs `@modelcontextprotocol/sdk`.

### Docs for coding agents

- `megh new` writes an `AGENTS.md` with the project's commands, layout and the
  Megh rules TypeScript can't check, and a `CLAUDE.md` that imports it. Add
  them to an existing project with `npx megh make:agents`. See
  [Application](/cli/basic#application).
- The docs site publishes [`/llms.txt`](https://meghjs.github.io/llms.txt), an
  index of every page for agents, and
  [`/llms-full.txt`](https://meghjs.github.io/llms-full.txt), every page in one
  file. Each page is also available as markdown: add `.md` to its URL.

### Other changes

- `megh route:list` shows a **TOOL** column when the app has `@Tool` routes,
  and `--json` adds a `tool` field to those routes.
- `@meghjs/mcp` adds `megh_list_ai_tools`, which lists the app's tools with
  safety warnings, and the `megh-add-ai-tools` prompt.
- Plugins can read each controller route's handler and input schema in
  Fastify's `onRoute` hook with `getRouteDescriptor(route)` from
  `@meghjs/core`.
- A route handler that sends the reply itself (for example after
  `reply.hijack()`) no longer logs "Reply was already sent".

## Breaking in 0.7.1

### Model method names are reserved

`Model` has new instance methods: `refresh`, `fresh`, `touch`, `replicate`,
`increment`, `decrement`, `makeVisible` and `makeHidden`.

**Affects you if** a model declares a column, getter or method with one of
these names. Rename it, or map the column to another property with
`@Column({ name })`. See
[Reserved names](/advanced/orm/models#instance-helpers).

### `Model.create()` goes through `save()`

`Model.create(values)` now builds an instance and calls `save()`, so it fires
the `saving`, `creating`, `created` and `saved` [events](/advanced/orm/models#events).

**Affects you if** you register model event handlers and expect them not to
run on `create()`. Query-level writes (`insert()`, `upsert()`,
`where(…).update()`) still fire no events.

### `IsArrayNotEmpty` is a Megh decorator

It used to register a class-validator rule. A class-validator DTO that uses it
now fails at startup, because it mixes the two libraries.

**Affects you if** a DTO imports other decorators from `class-validator` and
uses `IsArrayNotEmpty`. Replace it with class-validator's `ArrayNotEmpty`, or
switch the whole DTO to `@meghjs/core`. Its constraint key
(`isArrayWithAtLeastOneElement`) and message are unchanged.

## New in 0.7.1

### class-validator and class-transformer are optional

`@meghjs/core` no longer loads class-validator or class-transformer when it
starts. Both are now optional peers: an app whose DTOs use Megh's decorators
runs without them, and `megh new` no longer adds them to new projects.

Apps with class-validator DTOs keep working unchanged while the two packages
are installed. A class-validator DTO validated without class-transformer
installed fails with an error naming the package to install.

To drop them, switch each DTO's imports to `@meghjs/core` (see
[Switching from class-validator](/core-concept/validation#switching-from-class-validator)),
then run `npm uninstall class-validator class-transformer`.

### Everything a DTO needed class-validator for

These now come from `@meghjs/core`, with class-validator's and
class-transformer's names, options, constraint keys and messages:

- custom validators: `@ValidatorConstraint`, `@Validate`, `registerDecorator`,
  `ValidateBy`, `buildMessage`, including async validators
  ([guide](/core-concept/validation#custom-validators)). Request validation
  waits for them; `validateDtoAsync` validates by hand.
- `@Expose` and `@Exclude`, on properties and classes, and
  `plainToInstance` / `instanceToPlain`
  ([guide](/core-concept/validation#shaping-responses))
- `@Type` with a `discriminator` (it used to throw)
- `ArrayUnique`, `ArrayContains`, `ArrayNotContains`, `Equals`, `NotEquals`,
  `IsNotEmptyObject`, `IsInstance`, `MinDate`, `MaxDate`, `IsDivisibleBy`,
  `IsTimeZone`, `IsPhoneNumber` and the string-format checks
  (`IsDateString`, `IsNumberString`, `IsAlpha`, `IsMongoId`, `IsIP`, …). See
  the [table](/core-concept/validation#decorators).

`@IsUUID()` no longer needs the `validator` package.

### A fuller ORM

- **Constrained eager loading:** `Todo.with('user', (q) => q.select('name'))`,
  with `where`, `orderBy` and a per-parent `limit()`. Unselected columns are a
  type error. See [Constraining eager loads](/advanced/orm/relations#constraining-eager-loads).
- **New relations:** [has many through](/advanced/orm/relations#has-many-through)
  and [polymorphic relations](/advanced/orm/relations#polymorphic-relations).
- **Model queries match `DB.table()`:** more conditions,
  [subqueries](/advanced/orm/queries#subqueries),
  [global scopes](/advanced/orm/queries#global-scopes),
  [streaming large results](/advanced/orm/queries#large-results),
  [cancelling](/advanced/orm/queries#cancelling-queries) and
  [row locks](/advanced/orm/queries#locking-rows).
- **Writes:** `firstOrNew`, `firstOrCreate`, `updateOrCreate`, `createMany`,
  bulk `insert` and `upsert` on every dialect. See
  [Finding or creating](/advanced/orm/queries#finding-or-creating) and
  [Many rows](/advanced/orm/queries#many-rows).
- **Models:** [hidden and visible columns](/advanced/orm/models#hiding-columns-from-json)
  (also left out of OpenAPI schemas), [events](/advanced/orm/models#events)
  and [instance helpers](/advanced/orm/models#instance-helpers).
- **`DB.table()`:** upsert, CTEs, unions, locks and streaming. See the
  [query builder](/advanced/orm/query-builder).

### Other changes

- **`HttpResponse.Ok(data, Class)` and `Created(data, Class)`** shape the data
  with Megh's conversion unless `Class` uses only class-transformer
  decorators, which keep using class-transformer. Results are the same; a
  response class that mixes Megh and class-transformer decorators now follows
  Megh's.
- **`transformAndValidate`** validates DTOs that use Megh's decorators with
  Megh's validator, as the router already did. Results are the same.
- **Generated code** (`megh new`, `make:dto`, `make:resource`,
  `scaffold:auth`) imports its decorators from `@meghjs/core`, and the test
  that `make:dto` writes uses `validateDto`.
- **`toJSON()`** on a model leaves out `hidden` columns, including those of
  loaded relations, and returns relations as plain objects.

## Breaking in 0.7.0

### Unresolvable constructor parameters throw

A constructor parameter typed as an interface, a union or a primitive has no
runtime type, so it used to be injected as `undefined`. The service then
failed later, far from the cause. Now the class fails when it is first built,
with a `ContainerError` that names the class and the parameter:

```
Cannot resolve parameter 0 of OrderService: its type is an interface, union
or primitive (emitted as Object). Use @Inject(TOKEN) on the parameter or
inject(TOKEN) in a field, type it as a class, or mark it @Optional().
```

**Affects you if** the app now fails at boot with this error. Fix the
parameter it names in one of these ways:

```ts
constructor(
  @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway, // a token
  @Optional() private readonly tracer?: Tracer,                        // undefined on purpose
) {}
```

`@Inject(token, { optional: true })` injects `undefined` when the token isn't
registered. Overrides and inject handlers still take precedence. See
[Dependency Injection: Errors](/core-concept/dependency-injection#errors).

### Mail addresses must be single addresses

A string such as `'ann@example.com, bob@example.com'` used to pass as one
address. The HTTP mailers (SendGrid, Mailgun, Postmark and Resend) sent it on
as is, so it reached every address in it. If the string came from user input,
an attacker could add themselves.

Each address must now be a single `local@domain` with no spaces, `,`, `;`,
`<`, `>` or quotes. A display name that contains a comma must be quoted:
`'"Lee, Ann" <ann@example.com>'`.

**Affects you if** you pass several recipients in one string. Pass an array
instead:

```ts
await mailer.to(['ann@example.com', 'bob@example.com']).send(new InvoiceMail());
```

### Attachment URLs are refused by default

Every mailer now checks attachment `path`s when the message is built. Local
files are allowed. `http(s)://` URLs are refused unless you turn them on,
because a URL built from input could fetch cloud metadata or internal
services and mail the response out.

**Affects you if** an attachment's `path` is a URL. Allow URLs only if every
URL is yours, and consider confining local files to one folder:

```ts
app.useMail({
  allowUrlAccess: true,               // default false
  attachmentRoot: 'storage/invoices', // optional: only read files in here
});
```

See [Mail: Attachment paths](/advanced/mail#attachment-paths).

### Rate limits are stricter

- **One counter per route across URI versions.** A route served at `/v1/...`
  and `/v2/...` by `@Version(['1', '2'])` used to get a separate limit per
  version. Now the versions share one counter.
- **IPv6 clients are grouped by `/64`.** A client rotating addresses within
  its `/64` used to get a fresh counter for every address. Change the prefix
  with `useRateLimit({ ipv6Subnet })`. IPv4-mapped IPv6 addresses count as
  IPv4.
- **The memory store holds at most 100,000 keys** and drops the oldest
  windows first, so random keys can't grow the heap without limit. Change it
  with `new MemoryRateLimitStore({ maxKeys })`.

**Affects you if** you rely on per-version limits, or many of your users share
an IPv6 `/64`. See [Security: Add rate limits](/production/security#add-rate-limits).

### `transports` only accepts `'socket'`

`SocketEventDispatcher.dispatch(event, data, { transports })` accepted
`'kafka'` and `'rabbitmq'` but ignored them. Any value other than `'socket'`
now throws before the event is sent.

**Affects you if** you pass `transports`. Remove the option, or use
`['socket']`. See [WebSocket: Emitting to clients](/microservices/websocket#emitting-to-clients).

### `megh -v` prints only the version

`megh -v` and `megh --version` print just the number, for example `0.7.0`. In
0.6.5 they printed the logo and `Megh v<version>`. The logo now appears only
with `megh --info`, which also has a short form, `megh -i`.

**Affects you if** a script parses `megh -v`. Read the whole output as the
version.

## New in 0.7.0

### Views

Megh renders HTML on the server with a Blade-style template engine:
`{{ }}` echoes, `@if` / `@foreach`, layouts with `@extends` and `@section`,
`@include`, stacks, and `<x-component>` tags with slots. Templates compile to
JavaScript once and are cached.

```ts
app.useViews(); // views/**/*.megh.html

@Get('/')
home() {
  return Results.View('pages.home', { user });
}
```

- **`@react` islands** mount a React component in the browser from inside a
  view. Compiling JSX needs `@swc/core`.
- **`app.useMethodOverride()`** lets HTML forms reach `PUT`, `PATCH` and
  `DELETE` routes with `@method('DELETE')`, and parses urlencoded bodies for
  `@Body()`.

See [Views](/advanced/views).

### MCP server for AI assistants

[`@meghjs/mcp`](/ai/mcp) is a new package: a Model Context Protocol server
that lets assistants such as Claude Code, Cursor and VS Code read the Megh
docs, inspect your project (routes, structure, migrations, type errors) and
run the `megh` generators. In Claude Code:

```sh
claude mcp add megh -- npx -y @meghjs/mcp
```

It has a `--read-only` mode, and it refuses to run migrations against a
production project. See [MCP Server](/ai/mcp).

### Deny-by-default authorization

A route without `@Authorized` is public, so forgetting it on one handler leaves
that endpoint open. You can now protect every route by default and mark the
open ones with `@Public()`:

```ts
app.useAuthorization(JwtAuthorization, { default: 'authenticated' });
```

It's off unless you set `default`, so existing apps behave as before.
`megh route:list` shows each route's protection in a new `AUTH` column. See
[Deny by default](/core-concept/authentication#deny-by-default).

### Request context

`requestContext` holds values for the current request, so code deep in a
service can read the current user or tenant without passing it through every
call:

```ts
import { requestContext } from '@meghjs/core';

const user = requestContext.getUser<User>();
```

Authentication sets `requestContext.user`. `requestContext.run(fn, init)`
gives workers, scripts and tests a context of their own. See
[Request Context](/core-concept/request-context).

### CLI

- **`megh new <name> --mvc`** creates a server-rendered app: `useViews()` and
  `useMethodOverride()` in `src/app.ts`, a layout, a home page, and a
  controller that renders it. See [CLI: Application](/cli/basic#application).
- **`megh make:view <name>`** (`m:v`) writes `views/<name>.megh.html`. Pages
  extend `layouts.app` when it exists; `--layout` picks another layout,
  `--no-layout` writes a standalone page, and `-c` writes an `<x-name>`
  component. See [Generators: View](/cli/generators#view).
- **A new logo** for `megh --info`, and `megh -i` as its short form.

## Fixes

- **Rate limiting warns when `trustProxy: true`.** With it, the client controls
  `X-Forwarded-For` and can get a fresh counter on every request. Use the
  number of proxy hops or the proxy's address instead. See
  [Terminate HTTPS at a proxy](/production/security#terminate-https-at-a-proxy).
- `rateLimitIpKey()` and `MemoryRateLimitStoreOptions` are exported.
- `setGlobalPrefix(prefix, { exclude })` matches inline routes whose path has
  no leading slash.
- In-memory queued events run in the request context they were dispatched in.
  They used to all run in the context of the first one.

## Coming from older versions

On 0.5.x or earlier, read [Upgrading to 0.6](/getting-started/upgrading-0.6)
first.
