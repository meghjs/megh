# Megh Templates for Neovim

Highlighting, completion, hover, formatting and validation for Megh view
templates (`*.megh.html`, see [Views](https://meghjs.github.io/advanced/views)).
Needs Neovim 0.10 or later and Node.js.

The language features come from the Megh language server, built from the
same code as the VS Code extension, so both editors behave the same. See
[the VS Code README](https://github.com/meghjs/megh/tree/main/editors/vscode#features) for what each
feature does.

> This repository is a read-only mirror of
> [`editors/neovim`](https://github.com/meghjs/megh/tree/main/editors/neovim) in the Megh monorepo.
> Please open issues and pull requests there.

## Features

- **Filetype** `megh` for `*.megh.html`, with HTML's ftplugin and indent.
- **Highlighting**: HTML, with `{{ }}`, `{!! !!}`, directive arguments,
  `@js ... @endjs` and `@react ... @endreact` as JavaScript, also inside
  attribute values and `<script>`; `{{-- --}}` as comments.
- **Completion** (LSP): directives after `@` (block ones as snippets with
  their closer), HTML tags and attributes, `<x-...>` components and their
  props, view variables inside `{{ }}` and directive arguments, `todo.`
  members, view, component and section names.
- **Hover** (`K`): directive docs, where a variable comes from, HTML docs.
- **Formatting**: `:lua vim.lsp.buf.format()`.
- **Diagnostics**: unclosed `{{`, unbalanced `@if` / `@endif`, HTML problems.
- **Closing tags** inserted after typing `>`, and after `</`.
- `gc` comments with `{{-- --}}`; `%` jumps between `@if` / `@else` / `@endif`
  and other block pairs (with matchit).

## Install

With [lazy.nvim](https://github.com/folke/lazy.nvim) (and LazyVim), e.g. in
`lua/plugins/megh.lua`:

```lua
return {
  'meghjs/megh.nvim',
  opts = {},
}
```

Without a plugin manager, clone `https://github.com/meghjs/megh.nvim` and:

```lua
vim.opt.rtp:prepend('/path/to/megh.nvim')
require('megh').setup()
```

The language server is bundled (`server/megh-language-server.js`) and runs
with `node`, so there is nothing to build.

## Options

```lua
require('megh').setup({
  -- Command that starts the server. Default: node <plugin>/server/megh-language-server.js --stdio
  cmd = { 'node', '/path/to/megh-language-server.js', '--stdio' },
  -- Insert </tag> after typing > or </.
  auto_close_tags = true,
  settings = {
    validate = {
      enable = true, -- report Megh structure problems
      html = true,   -- also report HTML problems
    },
    -- HTML formatter options, as in VS Code's html.format.*
    format = { wrapLineLength = 120, wrapAttributes = 'auto' },
  },
})
```

Completion uses Neovim's LSP client: `<C-x><C-o>` works out of the box, and
completion plugins (nvim-cmp, blink.cmp) pick it up as an LSP source.

## Try it

Open any template under a `views/` folder (one with a `components/` folder
gives component completion) and run `:checkhealth vim.lsp` to see the `megh`
client. Then:

1. Inside `{{ todo. }}`, press `<C-x><C-o>`: you get `id`, `title`, `done`, ...
2. Put the cursor on `@foreach` and press `K`: the directive's docs open.
3. Delete an `@endif`: the diagnostic shows up on the matching `@if`.
4. Type `<section>`: `</section>` is inserted after the cursor.

## Limits

The same as [the VS Code extension's](https://github.com/meghjs/megh/tree/main/editors/vscode#limits). Also, app code
(`view('name', { ... })`) is read again when you save a `.ts` / `.js` file in
Neovim; changes made outside Neovim are picked up on the next save of a
template, or with `:MeghRestart`.

## Develop

In the [monorepo](https://github.com/meghjs/megh): the plugin is `editors/neovim`, the server is
`editors/vscode/src/server.ts`. After changing the server, rebuild the bundle
and commit it:

```sh
cd editors/vscode
npm run build:server   # writes ../neovim/server/megh-language-server.js
```

To try local changes with lazy.nvim, use `dir = '/path/to/meghjs/editors/neovim'`
instead of `'meghjs/megh.nvim'`. `scripts/mirror.sh neovim` pushes this folder
to `meghjs/megh.nvim`; it refuses if the bundle is out of date.
