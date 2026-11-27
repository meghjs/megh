# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.7.3](https://github.com/meghjs/megh/compare/v0.7.2...v0.7.3) (2026-11-27)

* feat(core)!: hide the Fastify instance; add registerFastifyPlugin ([6fbcd77](https://github.com/meghjs/megh/commit/6fbcd77039d7bf2d6e46c11649d41f8b381817d0))

### BREAKING CHANGES

* `app.app` is removed. Use registerFastifyPlugin(),
  inject(), address() and close() instead.



## [0.7.2](https://github.com/meghjs/megh/compare/v0.7.1...v0.7.2) (2026-11-24)

### Features

* **ai:** add @meghjs/ai with @Tool() LLM tools ([1aa19e4](https://github.com/meghjs/megh/commit/1aa19e4a6f2fa64d7e477641c45f87bc2147ad02)), closes [megh-add-ai-tools](https://github.com/me/issues/add-ai-tools)
* **ai:** serve @Tool routes over MCP with app.useMcp() ([5fdf1e2](https://github.com/meghjs/megh/commit/5fdf1e26fa28ffa0a5fd9add96d3a2697c5dc7cd)), closes [megh-add-ai-tools](https://github.com/me/issues/add-ai-tools)
