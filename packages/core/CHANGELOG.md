# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.7.3](https://github.com/meghjs/megh/compare/v0.7.2...v0.7.3) (2026-11-27)

- feat(core)!: hide the Fastify instance; add registerFastifyPlugin ([6fbcd77](https://github.com/meghjs/megh/commit/6fbcd77039d7bf2d6e46c11649d41f8b381817d0))

### Bug Fixes

- **core:** use the private Fastify instance and app.inject() after [#179](https://github.com/meghjs/megh/issues/179) ([f97fa9f](https://github.com/meghjs/megh/commit/f97fa9f1f985edccf6283aa8f94728d45298aab3))

### Features

- **core:** sessions, login redirect, gates and auth view directives ([eaeb127](https://github.com/meghjs/megh/commit/eaeb127c69dfb39a1aea925269a7394b6f1cd1fd))

### BREAKING CHANGES

- `app.app` is removed. Use registerFastifyPlugin(),
  inject(), address() and close() instead.

## [0.7.2](https://github.com/meghjs/megh/compare/v0.7.1...v0.7.2) (2026-11-24)

### Features

- **ai:** add @meghjs/ai with @Tool() LLM tools ([1aa19e4](https://github.com/meghjs/megh/commit/1aa19e4a6f2fa64d7e477641c45f87bc2147ad02)), closes [megh-add-ai-tools](https://github.com/me/issues/add-ai-tools)
- **ai:** serve @Tool routes over MCP with app.useMcp() ([5fdf1e2](https://github.com/meghjs/megh/commit/5fdf1e26fa28ffa0a5fd9add96d3a2697c5dc7cd)), closes [megh-add-ai-tools](https://github.com/me/issues/add-ai-tools)

## [0.7.1](https://github.com/meghjs/megh/compare/v0.7.0...v0.7.1) (2026-11-23)

### Features

- **core:** constrained eager loading and a fuller model query builder ([ad58a16](https://github.com/meghjs/megh/commit/ad58a16880e6638b6a730b296d4b057233429d3c))
- **core:** declare through and polymorphic relations ([eca3980](https://github.com/meghjs/megh/commit/eca3980bb8df4fe0b37ca6a7e7ca389bdc21d768))
- **core:** hidden columns, model events and upserts on Model ([c4fbea5](https://github.com/meghjs/megh/commit/c4fbea50fa5429a726206c3dfde6c15a792b6237))
- **core:** make class-validator and class-transformer optional ([6f1ba3f](https://github.com/meghjs/megh/commit/6f1ba3f09443beeec2e4405a806d90d1d6027791))
- **core:** upsert, CTEs, unions, locks and streaming on DB.table() ([ed8c4d5](https://github.com/meghjs/megh/commit/ed8c4d590c71dd188e3a429ac3ca96b51c6d7b66))

### BREAKING CHANGES

- **core:** IsArrayNotEmpty is now a Megh decorator, so a
  class-validator DTO that uses it fails at startup as a mixed DTO. Use
  class-validator's ArrayNotEmpty there.
- **core:** Model now has refresh, fresh, touch, replicate,
  increment, decrement, makeVisible and makeHidden methods, so a model
  declaring a member with one of those names must rename it.
  Model.create() goes through save() and fires the save events.

# [0.7.0](https://github.com/meghjs/megh/compare/v0.6.5...v0.7.0) (2026-11-21)

### Bug Fixes

- **core:** cap the memory rate-limit store and group IPv6 clients by /64 ([#135](https://github.com/meghjs/megh/issues/135)) ([9b22398](https://github.com/meghjs/megh/commit/9b22398a66f3f9431a4362dc35f14d853c047aee))
- **core:** check mail attachment paths against allowFileAccess, allowUrlAccess and attachmentRoot ([#139](https://github.com/meghjs/megh/issues/139)) ([a6f8c16](https://github.com/meghjs/megh/commit/a6f8c16fd63df05a260f106b5409ad16093fb93c))
- **core:** export rateLimitIpKey and MemoryRateLimitStoreOptions ([#135](https://github.com/meghjs/megh/issues/135)) ([223356e](https://github.com/meghjs/megh/commit/223356edad172de0d73b1b0694485ea445eb7828))
- **core:** fail when a constructor parameter can't be resolved ([#137](https://github.com/meghjs/megh/issues/137)) ([5d44c99](https://github.com/meghjs/megh/commit/5d44c99e871e2b1ed4ba764335996403f4618e19))
- **core:** ignore component tags in view comments; allow [@else](https://github.com/else) in [@isset](https://github.com/isset) ([d647c55](https://github.com/meghjs/megh/commit/d647c55ff2ee8b2305aa69ec21c2b417149ebda3))
- **core:** reject mail addresses that would reach several recipients ([#134](https://github.com/meghjs/megh/issues/134)) ([42880df](https://github.com/meghjs/megh/commit/42880df88c935a9e75a19a28faf12de0b8ce9c3c))
- **core:** reject unimplemented kafka/rabbitmq socket transports ([#57](https://github.com/meghjs/megh/issues/57)) ([0df2d09](https://github.com/meghjs/megh/commit/0df2d09c1ef510f0efaf7c645c31c33a5284e1cc))
- **core:** share a route's rate-limit counter across URI versions ([#136](https://github.com/meghjs/megh/issues/136)) ([24a8976](https://github.com/meghjs/megh/commit/24a8976a44914080418ee525f12418898d545c2e))
- **core:** warn when rate limiting runs with trustProxy: true ([#133](https://github.com/meghjs/megh/issues/133)) ([e33ddf1](https://github.com/meghjs/megh/commit/e33ddf1aeaf92418c3eeede15f736389a76ddf60))
- setGlobalPrefix exclude should match inline routes without leading slash ([#138](https://github.com/meghjs/megh/issues/138)) ([3b42bb8](https://github.com/meghjs/megh/commit/3b42bb88fe493f5af6fdc1279e1d970163f05cd2))

### Features

- **core:** add [@react](https://github.com/react) islands to views ([8d429cd](https://github.com/meghjs/megh/commit/8d429cdeb911bc5e684984eec4bb4fa3206a2dee))
- **core:** add Blade-style view engine ([5761c29](https://github.com/meghjs/megh/commit/5761c29f3783a7b060f4f0391d789ad2a3767657))
- **core:** add useMethodOverride() for HTML forms ([e7b5d2d](https://github.com/meghjs/megh/commit/e7b5d2d04ed3e206424c4efdae2b81d41022e3d4))
- **core:** opt-in deny-by-default authorization with @Public() ([#142](https://github.com/meghjs/megh/issues/142)) ([55c2c64](https://github.com/meghjs/megh/commit/55c2c6483c88a51bba13244d293f4c5e405a76ff))
- **core:** request context API for per-request values ([#141](https://github.com/meghjs/megh/issues/141)) ([6570a46](https://github.com/meghjs/megh/commit/6570a46c0ad21bc1b16284dfe454cd059a549587))

## [0.6.5](https://github.com/meghjs/megh/compare/v0.6.3...v0.6.5) (2026-11-17)

### Bug Fixes

- **core:** fix the core issues from the 1.0 checklist ([c8bf632](https://github.com/meghjs/megh/commit/c8bf63217665f84aa1f9c3da69ee325561e2a20a)), closes [#106](https://github.com/meghjs/megh/issues/106) [#105](https://github.com/meghjs/megh/issues/105) [#104](https://github.com/meghjs/megh/issues/104) [#100](https://github.com/meghjs/megh/issues/100) [#99](https://github.com/meghjs/megh/issues/99) [#98](https://github.com/meghjs/megh/issues/98) [#97](https://github.com/meghjs/megh/issues/97) [#69](https://github.com/meghjs/megh/issues/69) [#55](https://github.com/meghjs/megh/issues/55) [#54](https://github.com/meghjs/megh/issues/54) [#53](https://github.com/meghjs/megh/issues/53) [#52](https://github.com/meghjs/megh/issues/52) [#51](https://github.com/meghjs/megh/issues/51) [#16](https://github.com/meghjs/megh/issues/16) [#106](https://github.com/meghjs/megh/issues/106) [#105](https://github.com/meghjs/megh/issues/105) [#104](https://github.com/meghjs/megh/issues/104) [#100](https://github.com/meghjs/megh/issues/100) [#99](https://github.com/meghjs/megh/issues/99) [#98](https://github.com/meghjs/megh/issues/98) [#97](https://github.com/meghjs/megh/issues/97) [#69](https://github.com/meghjs/megh/issues/69) [#55](https://github.com/meghjs/megh/issues/55) [#54](https://github.com/meghjs/megh/issues/54) [#53](https://github.com/meghjs/megh/issues/53) [#52](https://github.com/meghjs/megh/issues/52) [#51](https://github.com/meghjs/megh/issues/51) [#16](https://github.com/meghjs/megh/issues/16)

### Features

- **core:** compression, route prefix and versioning, redirects, config schemas, socket auth ([4f5617d](https://github.com/meghjs/megh/commit/4f5617d1376791e0abdb2eb49507db90b60d8cdb)), closes [#59](https://github.com/meghjs/megh/issues/59) [#60](https://github.com/meghjs/megh/issues/60) [#61](https://github.com/meghjs/megh/issues/61) [#62](https://github.com/meghjs/megh/issues/62) [#63](https://github.com/meghjs/megh/issues/63) [#59](https://github.com/meghjs/megh/issues/59) [#60](https://github.com/meghjs/megh/issues/60) [#61](https://github.com/meghjs/megh/issues/61) [#62](https://github.com/meghjs/megh/issues/62) [#63](https://github.com/meghjs/megh/issues/63)

## [0.6.3](https://github.com/meghjs/megh/compare/v0.6.2...v0.6.3) (2026-11-16)

**Note:** Version bump only for package @meghjs/core

## [0.6.2](https://github.com/meghjs/megh/compare/v0.6.1...v0.6.2) (2026-11-16)

### Bug Fixes

- **cli:** put the module folder before the type folder in make:* ([9dec4ee](https://github.com/meghjs/megh/commit/9dec4ee3e13969e4ffbcbacab5cfd251faf2e0be))

## [0.6.1](https://github.com/meghjs/megh/compare/v0.6.0...v0.6.1) (2026-11-16)

### Bug Fixes

- **core:** list every mailer in the "No mailer is set" error ([a0e0697](https://github.com/meghjs/megh/commit/a0e0697e8a55ef1c6ff324a05270e702f1d25ce8)), closes [#114](https://github.com/meghjs/megh/issues/114)

### Features

- **core:** add mail with SMTP, log and array mailers ([66e4603](https://github.com/meghjs/megh/commit/66e460324f2dc22b7875c87c9b5b0c01ed1f5498)), closes [#114](https://github.com/meghjs/megh/issues/114)
- **core:** add SendGrid, Mailgun, Postmark, Resend and failover mailers ([5062ff0](https://github.com/meghjs/megh/commit/5062ff039eff1a893ebbc04ee3e81ac9c700c743)), closes [#114](https://github.com/meghjs/megh/issues/114)
- **core:** add useSecurityHeaders(), useRateLimit() and @RateLimit() ([7e40bc0](https://github.com/meghjs/megh/commit/7e40bc0bd65af52c17a1584ca04b7362728223b4)), closes [#58](https://github.com/meghjs/megh/issues/58)
- **core:** merge a mailer's useMail() options over its .env settings ([510c079](https://github.com/meghjs/megh/commit/510c0798a993983dc36237215f8287c69f5e8489)), closes [#114](https://github.com/meghjs/megh/issues/114)
- **core:** queue mail with queue() and later() ([c706873](https://github.com/meghjs/megh/commit/c7068734478f85dfbb25fc57f24ef48a6828e403)), closes [#114](https://github.com/meghjs/megh/issues/114)

# [0.6.0](https://github.com/meghjs/megh/compare/v0.5.5...v0.6.0) (2026-11-12)

- feat(core)!: default run() to the PORT environment variable ([3261312](https://github.com/meghjs/megh/commit/3261312d2670baa079ee106973af73c98dbd8a07)), closes [#102](https://github.com/meghjs/megh/issues/102)
- feat(core)!: remove no-op and unused public APIs ([646187a](https://github.com/meghjs/megh/commit/646187a4f381bd090e042562b8101d7f254ea453)), closes [#86](https://github.com/meghjs/megh/issues/86) [#87](https://github.com/meghjs/megh/issues/87) [#88](https://github.com/meghjs/megh/issues/88) [#89](https://github.com/meghjs/megh/issues/89) [#90](https://github.com/meghjs/megh/issues/90) [#91](https://github.com/meghjs/megh/issues/91) [#92](https://github.com/meghjs/megh/issues/92) [#93](https://github.com/meghjs/megh/issues/93)

### BREAKING CHANGES

- apps that call app.run() without a port and have PORT
  set to something other than 4000 now listen on PORT. Pass the port
  explicitly to keep the old behaviour.
- useHttps(), useSerialization(), mapFeatures(),
  MeghSocketIo, DuplicateRouteException, MeghRouter.mapRoute(),
  MeghRouter.registerMiddleware(), CreateSwaggerObjectSchema and
  GetObjectSchema are removed. They did nothing or duplicated another
  API. Use generateClassSchema in place of the schema aliases. The
  startup line is now a pino log entry instead of console.log.

## [0.5.5](https://github.com/meghjs/megh/compare/v0.5.4...v0.5.5) (2026-11-12)

- feat(core)!: one pipeline order, and complete inline routes ([e4aa8fa](https://github.com/meghjs/megh/commit/e4aa8fa0f664869232392a61b1498ba97444b285))

### Bug Fixes

- **core:** respect the declared type when casting path and query values ([dcebb02](https://github.com/meghjs/megh/commit/dcebb02ec626ff6d870f2400e00f159410bf23b1))
- **core:** runtime bugs from the 1.0 checklist ([255cc5d](https://github.com/meghjs/megh/commit/255cc5d688eeaa858c26b17e75946578ac296a75))

### Features

- **core:** compiled DTO validation and Megh's own validation decorators ([7415c00](https://github.com/meghjs/megh/commit/7415c00710bf6a631053140b7111a1b957db023a))
- **core:** health endpoints and request IDs ([fe01391](https://github.com/meghjs/megh/commit/fe01391d7e501560c65598df07ff685cbb2276a2))
- **core:** pluggable error handling with exception filters ([2e0c317](https://github.com/meghjs/megh/commit/2e0c317c071cd882236062ad09bd6dcad453a862))

### BREAKING CHANGES

- @UseMiddleware runs before authentication and
  @Authorized, so it can no longer read request.user.

## [0.5.4](https://github.com/meghjs/megh/compare/v0.5.3...v0.5.4) (2026-11-09)

### Bug Fixes

- **openapi:** document @Query() parameters ([30d6a42](https://github.com/meghjs/megh/commit/30d6a42050a02dc823623948620d53f22ed442cf))

## [0.5.3](https://github.com/meghjs/megh/compare/v0.5.2...v0.5.3) (2026-11-08)

### Bug Fixes

- **orm:** return inserted rows with OUTPUT on SQL Server ([2751a28](https://github.com/meghjs/megh/commit/2751a28b73b934b3475250c9488efbbbf0f2aa0c))
- **orm:** show the real SQL Server error when a transaction is aborted ([53c7e5b](https://github.com/meghjs/megh/commit/53c7e5bc91e4a9ee54ea13b4a1bc12b94f8b9fa7))
- **orm:** SQL Server inserts and column drops, plus a cross-database REST suite ([df9c175](https://github.com/meghjs/megh/commit/df9c175fbb1f24f281e966fc76a0b29f41b3ce68))

### Features

- **openapi:** typed options and responses from DTOs and models ([fdf954f](https://github.com/meghjs/megh/commit/fdf954ff370ee78f0f93ac0594c567673c70cbaf))
- **orm:** model factories with Faker ([0886f4e](https://github.com/meghjs/megh/commit/0886f4e3fbdba95ca95671909ff424bd0654c7a1))
- **orm:** seeders with defineSeeder and a Seeders runner ([5e02c0f](https://github.com/meghjs/megh/commit/5e02c0f73422ff95ac62184ba25db9061d10269d))
- **orm:** type relation fields with the related model ([eb1f85d](https://github.com/meghjs/megh/commit/eb1f85d7bb842186c8ac8ad226e91e25254ec903))

## [0.5.2](https://github.com/meghjs/megh/compare/v0.5.1...v0.5.2) (2026-11-08)

### Bug Fixes

- **core:** resolve class middleware from @UseMiddleware through DI ([6896d9a](https://github.com/meghjs/megh/commit/6896d9aa9bebf5f334d55fe7bbf631151150f3b8))
- **orm:** page queries with top/offset-fetch on SQL Server ([e9b308b](https://github.com/meghjs/megh/commit/e9b308b9591c19489f32146cc85638845df206e1))

## [0.5.1](https://github.com/meghjs/megh/compare/v0.5.0...v0.5.1) (2026-11-08)

### Bug Fixes

- **core:** use the current Megh favicon in Swagger UI ([cf8bbcc](https://github.com/meghjs/megh/commit/cf8bbccb9721dc4ffd601e3b285f6a15a87dd7d7))

### Features

- **core:** extend the ORM query builder and models ([e2448fe](https://github.com/meghjs/megh/commit/e2448fe37bd6662477bcd20448f6fd90385039ca))
- **core:** inject() for field initializers, tokens and optional services ([9f55a7c](https://github.com/meghjs/megh/commit/9f55a7c8c5ec28da08c35f5e0344051bbd4cb5b8))
- **core:** MeghORM connects itself, decorators and a schema builder ([e351486](https://github.com/meghjs/megh/commit/e35148688ad6ca04b797e5cc24068e7ff374a0e2))
- **core:** replace typedi with Megh's own DI container ([82a8743](https://github.com/meghjs/megh/commit/82a87430ab689e06307368f2ff208f4a90cecd87))
- **core:** show the Megh logo and favicon in Swagger UI ([eff092e](https://github.com/meghjs/megh/commit/eff092eefdf8652799d3e123b82611dc7d9b6771))
- **orm:** DB query builder, decorator models from make:model, ORM in megh new ([d810a09](https://github.com/meghjs/megh/commit/d810a09bc617acbd3e50cc3ed41130996f419805))
- **orm:** map model properties to column names ([9cbebce](https://github.com/meghjs/megh/commit/9cbebce7ba369a123b3b755902e78769c66608a0))
- **rename:** rename Models (ORM) to MeghORM ([ac3369f](https://github.com/meghjs/megh/commit/ac3369f4244eb35fdbda0f86a30e1f4061db0f82))

# [0.5.0](https://github.com/meghjs/megh/compare/v0.4.1...v0.5.0) (2026-11-01)

- refactor!: rename Avleon to Megh ([e4239e0](https://github.com/meghjs/megh/commit/e4239e0b838b78115df655ccf8a25a5cb4c0c27a)), closes [megh-env](https://github.com/me/issues/env) [x-megh-request-body](https://github.com/x-me/issues/request-body)

### BREAKING CHANGES

- install @meghjs/core, @meghjs/cli and @meghjs/data in
  place of the [@avleon](https://github.com/avleon) packages. Avleon.createApplication() is now
  Megh.createApplication() and every Avleon* export is renamed to Megh*.
  The CLI command is megh, the package.json config key is "megh" (was
  "avleon"), plugins declare "megh": { "plugin" }, the generated types
  file is megh-env.d.ts, AVLEON_QUEUE_DRIVER and AVLEON_SKIP_INSTALL are
  MEGH_QUEUE_DRIVER and MEGH_SKIP_INSTALL, MEGH_KNEX_DB replaces
  AVLEON_KNEX_DB, and the OpenAPI extension is x-megh-request-body.

## [0.4.1](https://github.com/avleonjs/avleon/compare/v0.4.0...v0.4.1) (2026-10-31)

### Bug Fixes

- **core:** document request bodies in the generated OpenAPI spec ([ab9ad42](https://github.com/avleonjs/avleon/commit/ab9ad42646780d76c1ca73d8c9dec2eebf4af47d))

### Features

- **core:** add type-safe models and migrations on top of Kysely ([c81dc88](https://github.com/avleonjs/avleon/commit/c81dc8820cd9b9422aa109b3dc176f19ddb919fc))

# [0.4.0](https://github.com/avleonjs/avleon/compare/v0.3.0...v0.4.0) (2026-10-30)

- feat!: add a plugin system and move TypeORM and Knex into @avleon/data ([ec444bc](https://github.com/avleonjs/avleon/commit/ec444bc2e97a0686f15c36805edac4cf2e8691e8))
- test!: replace jest with vitest ([ddff510](https://github.com/avleonjs/avleon/commit/ddff51057108b48084ef259c1cd82d6520429dd4))
- fix(core)!: upgrade dependencies with known vulnerabilities ([6a2781f](https://github.com/avleonjs/avleon/commit/6a2781f47143c00a96825f753d2122e16355754a))

### BREAKING CHANGES

- core no longer exports MockDB, which called the global
  jest.fn() and only worked under Jest. Projects generated by `avleon new`
  use Vitest; existing projects are unaffected.
- core's optional peer ranges move from @fastify/static
  ^8.0.0 to ^10.1.2 and from @fastify/swagger-ui ^5.0.0 to ^6.1.2. Every
  8.x and 9.x release of @fastify/static is vulnerable to path traversal.
  Apps that use static files or Swagger UI must upgrade those plugins.
- useTypeORM, useKnex, InjectRepository, KnexDB,
  AvleonRepository and the other database APIs move from @avleon/core to
  @avleon/data; install it to keep using them. useDatasource(), the
  dataSourceOptions app option, TestAppOptions.dataSource and the unused
  KnexHooks types are removed. AvleonContainer exposes only get, set, has
  and reset, and @Utility()/@Helper() no longer take typedi options.
