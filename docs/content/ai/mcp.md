---
title: MCP Server
description: The Megh MCP server lets AI assistants read the Megh docs, inspect your app and run the generators. Coming after v0.7.5.
---

# MCP Server <Badge type="tip" text="coming soon" />

::: info Coming after v0.7.5
The Megh MCP server is in development. It ships as a new package,
`@meghjs/mcp`, after Megh v0.7.5. This page will have the setup steps once it
is on npm.
:::

The [Model Context Protocol](https://modelcontextprotocol.io) (MCP) is an open
standard for connecting AI assistants to tools and data. The Megh MCP server
plugs Megh into assistants such as Claude Code, Claude Desktop, Cursor and
VS Code, so they work from your real project and the real docs instead of
guessing.

## What it will do

- **Read the Megh docs.** The docs ship with the server and match its
  version, so the assistant searches and reads the right API instead of
  relying on memory.
- **Inspect your project.** It can read your dependencies, list source files by
  kind, list routes, check migration status, and run the `megh doctor` checks and
  your TypeScript compiler.
- **Run the generators.** It runs `make:*` and `scaffold:*` the same way the CLI does,
  using the `@meghjs/cli` installed in your project, so the code matches your
  `@meghjs/core`.
- **Run migrations and seeders,** and refuse to when the project runs in
  production.
- **Run read-only.** With `--read-only`, every tool that writes files or changes
  the database is left out.

## Setup preview

Once `@meghjs/mcp` is published, adding it should take one command. In
Claude Code, from your project folder:

```sh
claude mcp add megh -- npx -y @meghjs/mcp
```

Any client that reads an `mcpServers` config:

```json
{
  "mcpServers": {
    "megh": {
      "command": "npx",
      "args": ["-y", "@meghjs/mcp", "/path/to/your/project"]
    }
  }
}
```

The package name and options may still change before the release.

## Follow along

Progress is tracked in the [Megh repository](https://github.com/meghjs/megh).
The [upcoming changes](/getting-started/upgrading-next) page lists what's
coming in the next release.
