# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.7.3](https://github.com/meghjs/megh/compare/v0.7.2...v0.7.3) (2026-11-27)

### Bug Fixes

* **cli:** approve pnpm build scripts in new projects ([ae14dbf](https://github.com/meghjs/megh/commit/ae14dbf1525c55035c1a2a00e8cefb242b55705b))



## [0.7.2](https://github.com/meghjs/megh/compare/v0.7.1...v0.7.2) (2026-11-24)

### Features

* AGENTS.md for new projects, llms.txt for the docs ([9a388c3](https://github.com/meghjs/megh/commit/9a388c39eb08573bf46eaf981ccd0a4dc0cb4046))
* **ai:** add @meghjs/ai with @Tool() LLM tools ([1aa19e4](https://github.com/meghjs/megh/commit/1aa19e4a6f2fa64d7e477641c45f87bc2147ad02)), closes [megh-add-ai-tools](https://github.com/me/issues/add-ai-tools)


## [0.7.1](https://github.com/meghjs/megh/compare/v0.7.0...v0.7.1) (2026-11-23)

### Features

* **core:** make class-validator and class-transformer optional ([6f1ba3f](https://github.com/meghjs/megh/commit/6f1ba3f09443beeec2e4405a806d90d1d6027791))

### BREAKING CHANGES

* **core:** IsArrayNotEmpty is now a Megh decorator, so a
  class-validator DTO that uses it fails at startup as a mixed DTO. Use
  class-validator's ArrayNotEmpty there.


# [0.7.0](https://github.com/meghjs/megh/compare/v0.6.5...v0.7.0) (2026-11-21)

### Features

* **cli:** add new --mvc and make:view ([a83c79d](https://github.com/meghjs/megh/commit/a83c79d6211c6c6d600109b9a731538493808b56))
* **cli:** new Megh CLI logo, shown only by --info ([63f27f7](https://github.com/meghjs/megh/commit/63f27f79d0498889409a54a657ef3f0628f54284))
* **core:** opt-in deny-by-default authorization with @Public() ([#142](https://github.com/meghjs/megh/issues/142)) ([55c2c64](https://github.com/meghjs/megh/commit/55c2c6483c88a51bba13244d293f4c5e405a76ff))



## [0.6.5](https://github.com/meghjs/megh/compare/v0.6.3...v0.6.5) (2026-11-17)

### Bug Fixes

* **cli:** alias @meghjs/core decorators that clash with a generated name ([e50bcad](https://github.com/meghjs/megh/commit/e50bcad6c42bade563268325f0a49746a9e0f93b))
* **cli:** megh doctor requires Node 22, like the packages ([6c3edb5](https://github.com/meghjs/megh/commit/6c3edb5dd8e8edb06b7bcefbc39ce494e1d22bc7)), closes [#101](https://github.com/meghjs/megh/issues/101)
* **cli:** run built migrations with megh migrate --compiled ([eadf1e7](https://github.com/meghjs/megh/commit/eadf1e71538bec53dfa59ae196128c854f11be0f)), closes [#107](https://github.com/meghjs/megh/issues/107)

### Features

* **cli:** generated unit tests, make:test, make:class and make:model --orm/--typeorm ([11a9ca6](https://github.com/meghjs/megh/commit/11a9ca6fbee8b688a4eb3a3e1968cbb29a03b0fe))


## [0.6.3](https://github.com/meghjs/megh/compare/v0.6.2...v0.6.3) (2026-11-16)

### Bug Fixes

* **cli:** make the CLI tests pass under lerna and the module-first layout ([7d7b7fd](https://github.com/meghjs/megh/commit/7d7b7fdc1a0ee0c4f3c89eaf8f2903751390e8ff)), closes [#124](https://github.com/meghjs/megh/issues/124)

### Features

* **cli:** shrink the Megh logo to about 60% of its size ([3cf87ac](https://github.com/meghjs/megh/commit/3cf87acc3ed9e1524f5a02a3cf5bc8ac27b250d4))


## [0.6.2](https://github.com/meghjs/megh/compare/v0.6.1...v0.6.2) (2026-11-16)

### Bug Fixes

* **cli:** put the module folder before the type folder in make:* ([9dec4ee](https://github.com/meghjs/megh/commit/9dec4ee3e13969e4ffbcbacab5cfd251faf2e0be))

### Features

* **cli:** add make:event, make:listener, make:queue, make:worker and make:task ([2e55e46](https://github.com/meghjs/megh/commit/2e55e469e9e4a8edd5370ed6dde9d2f1d2752b37))
* **cli:** rename update:model to sync:model and review changes before writing ([bd97a70](https://github.com/meghjs/megh/commit/bd97a70115ff38dcbe084e8a9d290f230f6d73f9))
* **cli:** show the Megh logo on megh new and the root help ([5f57bd1](https://github.com/meghjs/megh/commit/5f57bd171ee7803e94e8a05439063f9292a8f025))
* **cli:** write each model decorator on its own line ([0e90f44](https://github.com/meghjs/megh/commit/0e90f44d7032ce211d292926ddcafa711c032cbf))


## [0.6.1](https://github.com/meghjs/megh/compare/v0.6.0...v0.6.1) (2026-11-16)

### Bug Fixes

* **cli:** install the OpenAPI packages in new projects ([2c04d2b](https://github.com/meghjs/megh/commit/2c04d2b636d1d20bb4127c2223e1933e10132c92))

### Features

* **cli:** add make:mail and a mail feature for megh new ([cbfd672](https://github.com/meghjs/megh/commit/cbfd6722d32059c6f6716ab5f43399ed6faa3f48)), closes [#114](https://github.com/meghjs/megh/issues/114)
* **cli:** document generated resource services with JSDoc ([3368039](https://github.com/meghjs/megh/commit/3368039a1f03f29457a7468487dcae268d555bcd)), closes [#111](https://github.com/meghjs/megh/issues/111)
* **cli:** run git init in new projects ([a16a01c](https://github.com/meghjs/megh/commit/a16a01cbbd4c4bd12602a03dbac42518100137c2))



# [0.6.0](https://github.com/meghjs/megh/compare/v0.5.5...v0.6.0) (2026-11-12)

### Bug Fixes

* **cli:** keep NODE_ENV out of the scaffolded .env ([3294d86](https://github.com/meghjs/megh/commit/3294d86c7e50a93f241de7e9e5354243fb4f61c4)), closes [#103](https://github.com/meghjs/megh/issues/103)


## [0.5.5](https://github.com/meghjs/megh/compare/v0.5.4...v0.5.5) (2026-11-12)

**Note:** Version bump only for package @meghjs/cli






## [0.5.4](https://github.com/meghjs/megh/compare/v0.5.3...v0.5.4) (2026-11-09)

### Bug Fixes

* **cli:** generate SQL Server-safe foreign keys ([a5712ac](https://github.com/meghjs/megh/commit/a5712ac1677e7bdcda6b5a2555dbf64d99c032ce))

### Features

* **cli:** scaffold tables, domains, auth and RBAC from templates ([4817b02](https://github.com/meghjs/megh/commit/4817b022189b0bbea1c093f9cddf38655ad106ed))


## [0.5.3](https://github.com/meghjs/megh/compare/v0.5.2...v0.5.3) (2026-11-08)

### Features

* **cli:** add update:model to sync a model with alter-table migrations ([09f43b8](https://github.com/meghjs/megh/commit/09f43b811086c18f4bd9e0b2cddacabba4d4277f))
* **cli:** document generated resources' responses; name nullable column types ([374fd2d](https://github.com/meghjs/megh/commit/374fd2d41c5b32a70319db0046342fc6231cec17))
* **cli:** make:factory with Faker values per column ([24cffde](https://github.com/meghjs/megh/commit/24cffdee82843960188f5cb20ef3ae626ab830b6))
* **cli:** make:seeder, db:seed and migrate --seed ([589ade5](https://github.com/meghjs/megh/commit/589ade5d9a0df24e9fc942f63ee6903d6503ef98))


## [0.5.2](https://github.com/meghjs/megh/compare/v0.5.1...v0.5.2) (2026-11-08)

**Note:** Version bump only for package @meghjs/cli





## [0.5.1](https://github.com/meghjs/megh/compare/v0.5.0...v0.5.1) (2026-11-08)

### Bug Fixes

* derive resource routes from singularized names ([c30961a](https://github.com/meghjs/megh/commit/c30961afa8b05f6759213ea19effa56ce97668e8))

### Features

* **cli:** add make:resource and generate Megh ORM models from migrations ([9872959](https://github.com/meghjs/megh/commit/9872959a4fca8c3b5ee5faa72eb697e58642150a))
* **core:** MeghORM connects itself, decorators and a schema builder ([e351486](https://github.com/meghjs/megh/commit/e35148688ad6ca04b797e5cc24068e7ff374a0e2))
* **orm:** DB query builder, decorator models from make:model, ORM in megh new ([d810a09](https://github.com/meghjs/megh/commit/d810a09bc617acbd3e50cc3ed41130996f419805))


# [0.5.0](https://github.com/meghjs/megh/compare/v0.4.1...v0.5.0) (2026-11-01)

* refactor!: rename Avleon to Megh ([e4239e0](https://github.com/meghjs/megh/commit/e4239e0b838b78115df655ccf8a25a5cb4c0c27a)), closes [megh-env](https://github.com/me/issues/env) [x-megh-request-body](https://github.com/x-me/issues/request-body)

### BREAKING CHANGES

* install @meghjs/core, @meghjs/cli and @meghjs/data in
  place of the [@avleon](https://github.com/avleon) packages. Avleon.createApplication() is now
  Megh.createApplication() and every Avleon* export is renamed to Megh*.
  The CLI command is megh, the package.json config key is "megh" (was
  "avleon"), plugins declare "megh": { "plugin" }, the generated types
  file is megh-env.d.ts, AVLEON_QUEUE_DRIVER and AVLEON_SKIP_INSTALL are
  MEGH_QUEUE_DRIVER and MEGH_SKIP_INSTALL, MEGH_KNEX_DB replaces
  AVLEON_KNEX_DB, and the OpenAPI extension is x-megh-request-body.


## [0.4.1](https://github.com/avleonjs/avleon/compare/v0.4.0...v0.4.1) (2026-10-31)

### Features

* **cli:** add make:migration and migrate commands ([0fd29c5](https://github.com/avleonjs/avleon/commit/0fd29c5a02596fb756df364cf3b0de2fa95c668a))


# [0.4.0](https://github.com/avleonjs/avleon/compare/v0.3.0...v0.4.0) (2026-10-30)

* test!: replace jest with vitest ([ddff510](https://github.com/avleonjs/avleon/commit/ddff51057108b48084ef259c1cd82d6520429dd4))

### Features

* **cli:** scaffold @avleon/data for database projects ([9858bc9](https://github.com/avleonjs/avleon/commit/9858bc9d995cd8a7f9a2f09cc486d6c0435afb19))

### BREAKING CHANGES

* core no longer exports MockDB, which called the global
  jest.fn() and only worked under Jest. Projects generated by `avleon new`
  use Vitest; existing projects are unaffected.
