---
title: Versioning Policy
description: How Megh versions its packages, what counts as a breaking change, and how to upgrade.
---

# Versioning Policy

Megh follows [semantic versioning](https://semver.org): `MAJOR.MINOR.PATCH`.

## One version for every package

Every `@meghjs` package (`core`, `cli`, `mcp` and `ai`) is released together
and always has the same version number, even when only one of them changed.
Use matching versions:

```json [package.json]
{
  "dependencies": { "@meghjs/core": "0.7.3" },
  "devDependencies": { "@meghjs/cli": "0.7.3" }
}
```

`@meghjs/data` is the exception: it is no longer released and stays at 0.7.2,
which works with `@meghjs/core` 0.7.2 and later 0.7 releases.

## Before 1.0

Megh is in `0.x`. Until 1.0:

| Release | Can contain |
|---------|-------------|
| Minor (`0.6.x` → `0.7.0`) | Breaking changes, plus anything else |
| Patch (`0.6.0` → `0.6.1`) | Bug fixes and new features. No breaking changes |

New features ship in patch releases, so a minor release before 1.0 means
something can break: read its upgrade guide first. 0.7.0 is the last minor
before 1.0; see [Upgrading to 0.7](/getting-started/upgrading-0.7).

Pin an exact version or use a tilde range (`~0.7.3`) so `npm install` never
picks up a new minor on its own. A caret range (`^0.7.3`) on a `0.x` version
already behaves like a tilde range.

Fixes go into the latest release only.

## From 1.0

| Release | Can contain |
|---------|-------------|
| Major (`1.x` → `2.0`) | Breaking changes |
| Minor (`1.2` → `1.3`) | New features and deprecations |
| Patch (`1.2.0` → `1.2.1`) | Bug fixes |

An API is deprecated in a minor release before it's removed in a major one.
Deprecated APIs are marked `@deprecated` in their types, so your editor shows
them struck through, and listed in the release notes.

## What counts as the public API

The public API is:

- everything exported from `@meghjs/core` (`import { … } from '@meghjs/core'`)
- the `megh` CLI commands and their options
- behaviour described in these docs, such as response shapes, status codes
  and the order of the request pipeline

These are **not** part of the public API and can change in any release:

- options under `experimental`, such as `experimental.compiledValidation`
- members marked `@deprecated` or described as internal
- the exports listed under [Other exports](/reference/api#other-exports) in
  the API reference. They're exported for Megh's own packages and may be
  hidden or removed before 1.0
- deep imports such as `@meghjs/core/dist/...`. The package's `exports` map
  blocks them anyway.
- the exact text of log and error messages

## Breaking changes

A change is breaking when a working app needs a code change to keep working
after the upgrade. For example:

- removing or renaming an export, method, decorator or option
- changing a default value, response shape or status code
- raising the minimum Node.js version (today `>=22`)
- raising the major version of a peer dependency, such as `@fastify/multipart`

Fixing a bug is not breaking, even when an app relied on the bug. If a fix is
likely to affect many apps, the release notes call it out.

## How changes are announced

Each release has:

- **A changelog**, generated from the commit messages. Breaking changes are
  listed under a `BREAKING CHANGES` heading.
  See [packages/core/CHANGELOG.md](https://github.com/meghjs/megh/blob/main/packages/core/CHANGELOG.md).
- **An upgrade guide** for any release with breaking changes, under
  *Upgrade Guides* in the sidebar, with before-and-after code.
- **[Upcoming changes](/getting-started/upgrading-next)**, which lists what has
  landed on `main` since the last release. Read it to prepare ahead of time.

## Upgrading

1. Read the upgrade guide for each release between your version and the new
   one, oldest first.
2. Update `@meghjs/core` and `@meghjs/cli` to the same version.
3. Run your type checker. Most removals show up as type errors.
4. Run your tests.
