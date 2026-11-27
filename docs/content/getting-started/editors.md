---
title: Editor Setup
description: Highlighting, completion, hover, formatting and validation for Megh view templates in VS Code, Neovim and other LSP editors.
---

# Editor Setup

<!-- v-pre: the page shows {{ }} template syntax, which Vue would otherwise evaluate. -->

:::: v-pre

Megh ships editor support for [view templates](/advanced/views)
(`*.megh.html`): a VS Code extension and a Neovim plugin. Both are built from
the same language server, so they behave the same. Other editors with an LSP
client can use that server directly.

You only need this if your app uses views. Controllers, services and
config are plain TypeScript, which your editor already handles.

## What you get

- **Highlighting.** HTML as usual, with Megh syntax on top, including inside
  attribute values and `<script>`. `{{ }}`, `{!! !!}`, directive arguments and
  `@js` are highlighted as JavaScript, and `@react … @endreact` as JSX.
- **Directive completion.** Type `@` to list every directive with its docs. A
  block directive on its own line is inserted with its arguments and its
  closing tag:

  ```html
  @foreach(items as item)
    |
  @endforeach
  ```

  Inside an open block, its closer comes first (`@endforeach` inside a
  `@foreach`). `@else` and `@elseif` are only offered where they're allowed.
- **HTML completion.** Tags, attributes and values, with VS Code's HTML data,
  next to Megh syntax (`<input value="{{ x }}" |`).
- **Components.** `<x-` lists the components in the nearest `components/`
  folder, with their props as attributes.
- **View variables.** Inside `{{ }}` and directive arguments you get the
  view's variables. They're read from:
  - `view('todos.show', { todo })` and `Results.View(...)` calls in your app
    code
  - `share()` data
  - for a layout or partial, the views that `@extends` or `@include` it
  - `@foreach` locals and `loop`

  After `todo.`, you get the properties other templates read from `todo`.
- **Names.** View names in `@include('` and `@extends('`, component names,
  and section names in `@section('` and `@yield('`.
- **Hover.** Directive docs, where a variable comes from
  (`todo: view data, todo.controller.ts:110`), and HTML and component docs.
- **Formatting.** HTML formatting with block directives indented like
  elements. A template with an unclosed construct is left as it is.
- **Validation**, as you type:
  - Errors, as the engine would throw them: an unclosed `{{` or `@if(`, `@if`
    without `@endif`, blocks closed in the wrong order, `@else` outside a
    block.
  - Warnings for HTML: unclosed tags, duplicate attributes, an `<x-...>` with
    no component file.

## VS Code

The extension isn't on the Marketplace yet. Build it from the repository and
install the `.vsix`:

```sh
git clone https://github.com/meghjs/megh
cd megh/editors/vscode
npm install
npm run package
code --install-extension megh-templates-0.1.0.vsix
```

Open any `*.megh.html` file. The status bar should show **Megh Template** as
the language.

| Setting                | Default | Meaning                          |
| ---------------------- | ------- | -------------------------------- |
| `megh.validate.enable` | `true`  | Report Megh structure problems   |
| `megh.validate.html`   | `true`  | Also report HTML problems        |
| `megh.autoClosingTags` | `true`  | Insert `</tag>` after typing `>` |

Formatting uses your `html.format.*` settings. Run **Format Document**, or turn
on `editor.formatOnSave`.

The extension also adds:
- `{{-- --}}` comment toggling
- folding for block directives
- snippets: `@ifelse`, an `@extends` page, an `@react` island, and `form:megh`,
  `form:method` and `form:upload` forms

::: tip Emmet
Emmet is off in templates, because it would also suggest abbreviations inside
`{{ }}`. To turn it on anyway, add this to your settings:

```json
"emmet.includeLanguages": { "megh": "html" }
```
:::

## Neovim

Needs Neovim 0.10 or later and Node.js. With
[lazy.nvim](https://github.com/folke/lazy.nvim) (and LazyVim), for example in
`lua/plugins/megh.lua`:

```lua
return {
  'meghjs/megh.nvim',
  opts = {},
}
```

Without a plugin manager, clone `https://github.com/meghjs/megh.nvim` and add:

```lua
vim.opt.rtp:prepend('/path/to/megh.nvim')
require('megh').setup()
```

The language server is bundled with the plugin and runs with `node`, so
there is nothing to build. Completion goes through Neovim's LSP client:
`<C-x><C-o>` works out of the box, and nvim-cmp and blink.cmp pick it up as an
LSP source. `K` shows hover docs, `:lua vim.lsp.buf.format()` formats, `gc`
comments with `{{-- --}}`, and `%` jumps between `@if`, `@else` and `@endif`
(with matchit).

```lua
require('megh').setup({
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

Run `:checkhealth vim.lsp` to see that the `megh` client is attached.
`:MeghRestart` restarts the server.

## Other editors

Any editor with an LSP client can run the Megh language server. It's a single
file, `editors/neovim/server/megh-language-server.js` in the repository, that
speaks LSP over stdio:

```sh
node /path/to/megh-language-server.js --stdio
```

- Start it for `*.megh.html` files, with your workspace folder as the root.
  It finds the `views/` folder and your app code from there.
- Settings go in `initializationOptions`, or in `workspace/didChangeConfiguration`,
  under a `megh` key:

  ```json
  {
    "megh": {
      "validate": { "enable": true, "html": true },
      "format": { "wrapLineLength": 120 }
    }
  }
  ```

The server provides completion (with snippets), hover, formatting and
diagnostics. Highlighting isn't part of LSP. Use the TextMate grammar in
`editors/vscode/syntaxes/` if your editor supports TextMate grammars;
otherwise HTML highlighting is a reasonable fallback.

## Limits

- Variables come from `view('name', { ... })` calls that pass an object
  literal. Data built elsewhere (`view('x', data)`) isn't seen.
- There are no types. `todo.` offers the properties other templates use, not
  the ones your `Todo` type declares.
- Validation doesn't type-check expressions or report undefined variables.
- Directives you add with `engine.directive()` are highlighted when written
  with parentheses (`@money(x)`), but aren't in completion.

Report editor problems on
[GitHub](https://github.com/meghjs/megh/issues). The editor source is in
`editors/` in the repository.

::::
