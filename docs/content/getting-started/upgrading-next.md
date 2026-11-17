---
title: Upcoming changes
description: Changes on main since 0.6.3 that can affect existing apps. This page becomes the upgrade guide for the next release.
---

# Upcoming changes

Changes for the next release are listed here as they land.

## `megh serve` compiles to `.megh/build/` (0.7.0)

`megh serve` used to compile into the tsconfig `outDir` (`dist/`), the same
folder as `megh build`, so one overwrote or deleted the other. It now
compiles into `.megh/build/`, and `dist/` only holds production builds.

- Add `.megh/` to `.gitignore` (and `.dockerignore`).
- `megh.entry: "dist/serve.js"` keeps working: under `megh serve` it runs
  `.megh/build/serve.js`.
- If you start the app another way during development and rely on
  `dist/` being the dev output, run `megh build` first or set
  `MEGH_BUILD_DIR`.

The changes that were on this page shipped in 0.6.0, 0.6.1 and 0.6.3. See
[Upgrading to 0.6](/getting-started/upgrading-0.6).
