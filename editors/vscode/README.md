# Megh Templates for VS Code

Highlighting, completion, hover, formatting and validation for Megh view
templates (`*.megh.html`, see [Views](https://meghjs.github.io/advanced/views)).

## Features

**Highlighting.** HTML as usual, with Megh syntax on top, also inside
attribute values, `<script>` and `<style>`. `{{ }}`, `{!! !!}`, directive
arguments, `:prop="expr"` and `@js` are JavaScript; `@react ... @endreact` is JSX.
Built-in directives and your own `engine.directive()` ones (written `@name(`).

**Completion.**
- Directives after `@`, with docs. A block directive on its own line is
  inserted with its arguments and closer (`@foreach(items as item)` …
  `@endforeach`). Inside an open block, its closer comes first, and `@else` /
  `@elseif` only where they're allowed.
- HTML tags, attributes, values and closing tags, with VS Code's HTML data and
  docs. Works next to Megh syntax (`<input value="{{ x }}" |`).
- `<x-` lists the components under the nearest `components/` folder, with
  their props as attributes (`type`, `:type`).
- Inside `{{ }}` and directive arguments, the view's variables:
  - from `view('todos.show', { todo, errors })`, `Results.View(...)` and
    `render(...)` calls in your app code;
  - shared ones from `.share('appName', ...)`;
  - in a layout or partial, the variables of the views that `@extends` or
    `@include` it; in a component, its props and `slot`;
  - `@foreach` / `@for` / `@js` locals, and `loop` with its properties.
- After `todo.`, the properties templates read from `todo`.
- View names in `@include('` / `@extends('`, component names in
  `@component('`, section names in `@section('` / `@yield('`.

**Hover.** Directive docs (`@foreach`, `@method`, ...), where a variable comes
from (`todo: view data, todo.controller.ts:110`), `loop.*` docs, HTML tag and
attribute docs, and a component's file and props.

**Formatting** (Format Document, or format on save). VS Code's HTML formatter
with your `html.format.*` settings. Block directives on their own line are
indented like elements; `@else` lines up with `@if`. Inline directives,
`@js` bodies and `@react` bodies are kept as written. If a template has an
unclosed construct or unbalanced blocks, formatting does nothing.

**Validation** (Problems panel, as you type).
- Errors, as the engine would throw them: unclosed `{{`, `{!!`, `{{--` or
  `@directive(`; `@if` without `@endif`; `@endif` without `@if`; blocks closed
  in the wrong order; `@else` outside `@if`.
- Warnings for HTML: unclosed and stray tags, duplicate attributes,
  `<x-...>` with no component file. Tags opened differently in `@if` / `@else`
  branches and closed once after `@endif` are fine.

**Also:** closing tags inserted after `>`, `{{-- --}}` comment toggling,
folding for block directives, and snippets (`@ifelse`, `@extends` page,
`@react` island, `form:method`, `form:upload`, ...).

## Settings

| Setting | Default | |
| --- | --- | --- |
| `megh.validate.enable` | `true` | Report Megh structure problems |
| `megh.validate.html` | `true` | Also report HTML problems |
| `megh.autoClosingTags` | `true` | Insert `</tag>` after typing `>` |

## Try it

Open this folder in VS Code and press `F5`. A second window opens on
`.internal/view-demo` with the extension loaded; open any file under `views/`.

## Install

```sh
npm install
npm run package                      # writes megh-templates-0.1.0.vsix
code --install-extension megh-templates-0.1.0.vsix
```

## Develop

```sh
npm test            # unit tests (node:test)
npm run typecheck
npm run build       # bundles src/ into dist/extension.js, and the server
```

- `src/server.ts` serves the same features over LSP (stdio) for other
  editors. `npm run build:server` bundles it into
  `../neovim/server/megh-language-server.js`, which is committed so the
  mirrored Neovim plugin works without a build step. Rebuild it after
  changing anything in `src/`.

- `src/mask.ts` finds Megh syntax and blanks it out, so
  `vscode-html-languageservice` sees plain HTML at the same offsets.
- `src/complete.ts` HTML features; `src/megh-code.ts` completion and hover
  inside Megh code; `src/project.ts` view data from app code and templates.
- `src/format.ts`, `src/validate.ts`, `src/directives.ts` (directive docs and
  block structure, keep in sync with `packages/core/src/view/directives.ts`).
- `syntaxes/megh.injection.tmLanguage.json` is generated: edit
  `scripts/build-grammar.mjs` and run `npm run build:grammar`.

## Limits

- Variables are found by reading `view('name', { ... })` calls with an object
  literal. Data built elsewhere (`view('x', data)`) is not seen, and there are
  no types: `todo.` offers the properties other templates use, not the ones
  your `Todo` type declares.
- Validation does not type-check expressions or find undefined variables.
- Emmet is not turned on, since it would also suggest abbreviations inside
  `{{ }}`. To use it anyway, add `"emmet.includeLanguages": { "megh": "html" }`
  to your settings.
