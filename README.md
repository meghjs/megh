<p align="center">
  <img src="resources/megh-logo.png" alt="MeghJs" width="320" />
</p>

# Megh

Megh is a TypeScript-first web framework built on [Fastify](https://fastify.dev). It provides decorator-based controllers, dependency injection, class-validator DTOs, generated OpenAPI docs, and first-party integrations for databases, queues, scheduling, caching, events and WebSockets.

```ts
import { Megh, ApiController, Get, Param } from "@meghjs/core";

@ApiController("/users")
class UserController {
  @Get("/:id")
  find(@Param("id") id: string) {
    return { id };
  }
}

const app = Megh.createApplication();
app.useControllers([UserController]);
app.run(4000);
```

> **Formerly Avleon.** `@avleon/*` is now `@meghjs/*`. See
> [Moving from Avleon to Megh](https://meghjs.github.io/getting-started/upgrading-megh).

Documentation: **https://meghjs.github.io**

## Repository layout

This monorepo holds the source for every Megh package and the docs site, so a change to the framework, its CLI templates and its documentation can land in one commit.

| Folder           | Package / site                                                | Published from                                                                 |
|------------------|---------------------------------------------------------------|--------------------------------------------------------------------------------|
| `packages/core/` | [`@meghjs/core`](https://www.npmjs.com/package/@meghjs/core)  | This repository (Lerna)                                                        |
| `packages/cli/`  | [`@meghjs/cli`](https://www.npmjs.com/package/@meghjs/cli)    | This repository (Lerna)                                                        |
| `packages/data/` | [`@meghjs/data`](https://www.npmjs.com/package/@meghjs/data)  | This repository (Lerna)                                                        |
| `docs/`          | https://meghjs.github.io (VitePress)                        | [meghjs/meghjs.github.io](https://github.com/meghjs/meghjs.github.io)  |
| `resources/`     | Logos and favicons                                            | n/a                                                                            |
| `scripts/`       | `mirror.sh`, which syncs `docs/` to its standalone repo       | n/a                                                                            |

`1.0-CHECKLIST.md` tracks the work for the 1.0 release; the current roadmap is in [`packages/core/README.md`](packages/core/README.md#roadmap-to-100).

`packages/*` are npm workspaces managed by [Lerna](https://lerna.js.org): one root lockfile, and `packages/cli` resolves `@meghjs/core` to the local source. Every package in `packages/` is published to npm unless its `package.json` has `"private": true`. A new internal library only needs a folder under `packages/` with a scoped name (`@meghjs/...`) and `"publishConfig": { "access": "public" }`. `docs/` is not a workspace and keeps its own lockfile.

## Getting started

```bash
npm install -g @meghjs/cli
megh new my-api
cd my-api
npm run dev        # or: megh serve
```

To add Megh to an existing project:

```bash
npm install @meghjs/core reflect-metadata class-validator class-transformer
```

`tsconfig.json` needs `"experimentalDecorators": true` and `"emitDecoratorMetadata": true`.

## Working on Megh

Requirements: Node.js 22.22+ or 24.15+ (needed by Lerna 10), npm and git. The published packages support Node.js 22 and newer, and CI tests them on Node.js 22 and 24.

```bash
npm run setup       # npm ci at the root (all packages) and in docs
npm run build       # build every package (lerna run build)
npm run typecheck
npm test            # every package's tests
npm run lint        # core
npm run docs:dev    # docs site at http://localhost:5173
npm run docs:build  # fails on dead links
```

Each package can also be worked on directly, for example `cd packages/core && npm test`, or with `npx lerna run test --scope @meghjs/core`. Install dependencies from the root with `npm install <dep> -w @meghjs/core`, not from inside the package.

To try local changes to `core` in a generated app, run `npm run build` in `packages/core/`, then `npm install <path-to>/packages/core` in the app.

## Publishing and deployment

All packages share one version (Lerna fixed mode, in `lerna.json`) and are released together from `main`:

```bash
npm run release     # lerna version
```

`lerna version` works out the next version from the conventional commits since the last `v*` tag (`fix:` is a patch, `feat:` a minor, `BREAKING CHANGE` a major), bumps every package, writes each `CHANGELOG.md`, commits `chore(release): vX.Y.Z`, and pushes the commit and the tag. Pass a version to override it, for example `npm run release -- 0.4.0`.

The `v*` tag starts `.github/workflows/release.yml`. It type-checks, lints, tests and builds everything, then runs `lerna publish from-package`, which publishes every public package whose version is not on npm yet, with provenance. It needs an `NPM_TOKEN` secret in this repository.

The docs site still deploys from its standalone repository. `npm run mirror` pushes the history of `docs/` to [meghjs/meghjs.github.io](https://github.com/meghjs/meghjs.github.io) with `git subtree split`, which deploys https://meghjs.github.io. Commit to that repository only through `mirror.sh`: a commit made there directly makes the next push fail until it is brought into the monorepo.

## Releases and versioning

- **Semver.** Patch releases fix bugs. Minor releases add backwards-compatible features. Breaking changes wait for the next major release and are deprecated (with a warning) for at least one minor release first, unless the change fixes a security issue.
- **Release order.** `core` and `cli` are released together with the same version. Update the version in `docs` afterwards.

## Security

Please report vulnerabilities privately to the maintainer ([GitHub @xtareq](https://github.com/xtareq)) rather than in a public issue.

## License

MIT © Tareq Hossain
