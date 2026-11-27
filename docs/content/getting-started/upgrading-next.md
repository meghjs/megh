---
title: Upcoming changes
description: Changes on main since 0.7.2 that can affect existing apps. This page becomes the upgrade guide for the next release.
---

# Upcoming changes

Changes on `main` since 0.7.2 are listed here as they land. They become the
upgrade guide for the next release.

## The Fastify instance is no longer public

`app.app` is gone. Megh keeps the Fastify instance to itself, so an app can't
change routing, hooks or error handling behind Megh's back. Replace each use:

| Before | After |
| --- | --- |
| `app.app.register(plugin, opts)` | `app.registerFastifyPlugin(plugin, opts)` |
| `app.app.inject({ method, url })` | `app.inject({ method, url })` |
| `app.app.server.address()` | `app.address()` |
| `app.app.close()` | `app.close()` |

`registerFastifyPlugin()` works before `run()` and inside `onInit()` hooks, and
throws once routes are mapped. Plugins still get the instance as `ctx.http`.
