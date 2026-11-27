---
title: Views
description: Server-rendered HTML with Blade-style templates.
---

# Views

<!-- v-pre: the page shows {{ }} template syntax, which Vue would otherwise evaluate. -->

:::: v-pre

Megh ships a template engine modelled on Laravel Blade: `{{ }}` echoes,
`@if` / `@foreach` directives, layouts, includes, stacks and `<x-component>`
tags. Templates compile to JavaScript once and are cached, so a render is a
function call. It has no dependencies.

## Setup

Point the app at your views folder. It defaults to `<cwd>/views`:

```ts [app.ts]
import path from "path";

app.useViews({ root: path.join(process.cwd(), "views") });
app.getViews().share("appName", "My App"); // available in every view
```

| Option      | Default                                | Meaning                                                                       |
| ----------- | -------------------------------------- | ----------------------------------------------------------------------------- |
| `root`      | `<cwd>/views`                          | Folder holding the views                                                      |
| `extension` | `.megh.html`                           | Template file extension                                                       |
| `cache`     | `false` only in `NODE_ENV=development` | `false` recompiles a file when it changes, so edits show up without a restart |
| `maxDepth`  | `100`                                  | Guard against a view including itself forever                                 |

View names use dots: `layouts.app` is `views/layouts/app.megh.html`. Names
that would leave the views folder (`../secret`) are rejected.

`megh new myapp --mvc` sets all of this up with a layout and a home page, and
`megh make:view pages.about` adds a page. See [CLI](/cli/basic#application).

## Returning a view

Return `Results.View` (or the `view` shorthand) from a controller or a
`mapGet` handler. It is sent as `text/html; charset=utf-8`:

```ts [controllers/home.controller.ts]
import { ApiController, Get, Results, view } from "@meghjs/core";

@ApiController("/")
export class HomeController {
  @Get("/")
  index() {
    return Results.View("home", { user: { name: "Ana" }, todos });
  }

  @Get("/gone")
  gone() {
    return view("errors.404", {}, 404).header("cache-control", "no-store");
  }
}

app.mapGet("/about", () => view("about"));
```

If a template throws, nothing has been sent yet, so the error goes through the
normal error handler and the client gets a 500.

::: warning Per-request data
`share()` data is global to the engine, which every request uses. Pass the
current user, CSRF token and similar values to `Results.View` instead.
:::

You can also render to a string anywhere, for example for an email:

```ts
import { getViewEngine } from "@meghjs/core";

const html = getViewEngine().render("emails.welcome", { user });
const inline = getViewEngine().renderString("Hi {{ name }}", { name: "Ana" });
```

## Syntax

| Syntax                                                                                             | Meaning                                                  |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `{{ expr }}`                                                                                       | Echo, HTML-escaped. `expr` is any JS expression          |
| `{!! expr !!}`                                                                                     | Echo raw (unescaped). Only use it on trusted HTML        |
| `{{-- comment --}}`                                                                                | Removed at compile time, tags inside it included        |
| `@{{ x }}` / `@@if`                                                                                | Literal `{{ x }}` / `@if` (for Vue/Alpine)               |
| `@if(c)` `@elseif(c)` `@else` `@endif`                                                             | Conditionals                                             |
| `@unless(c)` … `@endunless`                                                                        | `if (!c)`                                                |
| `@isset(a.b.c)` … `@endisset`                                                                      | True if the path exists and isn't null. Never throws. Takes `@else` / `@elseif` |
| `@foreach(items as item)` / `@foreach(obj as key => value)`                                        | Arrays, Maps, Sets, iterables and plain objects          |
| `loop.index` `.iteration` `.first` `.last` `.count` `.remaining` `.even` `.odd` `.depth` `.parent` | Like Blade's `$loop`                                     |
| `@for(let i = 0; i < 3; i++)` … `@endfor`, `@while(c)` … `@endwhile`                               | Plain JS loops                                           |
| `@break` `@continue` / `@break(cond)`                                                              | Loop control                                             |
| `@js(const x = 1)` / `@js … @endjs`                                                                | Raw JS (Blade's `@php`)                                  |
| `@json(value)`                                                                                     | JSON that's safe inside `<script>`                       |
| `@csrf` `@method('PUT')`                                                                           | Hidden form inputs (`@csrf` reads `csrfToken`), see [Forms](#forms) |
| `@auth` … `@else` … `@endauth` / `@guest` … `@endguest`                                            | Logged in or not, per `useAuthentication()`. See [Sessions](/advanced/sessions#in-views) |
| `@session('status')` … `{{ value }}` … `@endsession`                                               | A session value (flashed ones too), only when set        |
| `@can('edit-post', post)` … `@else` … `@endcan` / `@cannot(...)` … `@endcannot`                    | Permission checks with [gates](/advanced/sessions#gates) |
| `@include('partials.nav', { extra })`                                                              | Render another view                                      |
| `@extends('layouts.app')`                                                                          | Use a layout                                             |
| `@section('name')` … `@endsection` / `@section('title', 'Home')`                                   | Define a section                                         |
| `@yield('name', 'default')`                                                                        | Print a section                                          |
| `@section('sidebar')` … `@show`                                                                    | Define and print at once (inside layouts)                |
| `@parent`                                                                                          | Inside a child section: insert the layout's version      |
| `@push('scripts')` … `@endpush` / `@stack('scripts')`                                              | Collect content from many views                          |
| `<x-alert type="error" :count="n">` … `</x-alert>`                                                 | Component, `views/components/alert.megh.html`            |
| `<x-slot:title>` … `</x-slot>`                                                                     | Named slot. The rest is `{{ slot }}`                     |
| `@react(props)` … `@endreact`                                                                      | React component mounted in the browser ([below](#react)) |

A directive glued to a word is plain text, which keeps `support@example.com`
intact: write `done @endif`, not `done@endif`. Only registered directive names
are recognised, so `@media` in CSS stays as is.

## Layouts

```html [views/layouts/app.megh.html]
<!doctype html>
<html>
  <head>
    <title>@yield('title', 'My App')</title>
    @stack('styles')
  </head>
  <body>
    @include('partials.nav')
    <main>@yield('content')</main>
    @stack('scripts')
  </body>
</html>
```

```html [views/home.megh.html]
@extends('layouts.app')

@section('title', 'Home')

@section('content')
  <h1>Hello, {{ user.name }}</h1>

  <x-alert type="warning">
    <x-slot:title>Heads up</x-slot>
    You have {{ todos.length }} todos.
  </x-alert>

  <ul>
  @foreach(todos as todo)
    <li>{{ loop.iteration }}. {{ todo.title }}@if(todo.done) ✓@endif</li>
  @endforeach
  </ul>
@endsection

@push('scripts')
  <script>window.todos = @json(todos);</script>
@endpush
```

```html [views/components/alert.megh.html]
<div class="alert alert-{{ type }}">
  @isset(title)<strong>{{ title }}</strong>@endisset {{ slot }}
</div>
```

The child renders first and fills its sections, then the layout renders and
`@yield`s them. Anything the child prints outside a section is dropped, as in
Blade.

## React

An `@react` block holds a React component written in JSX (or TSX). Megh
compiles it once, on the server, and the page gets an empty element plus a
`<script type="module">` that mounts the component in the browser. The
expression in `@react(...)` becomes the component's props:

```html [views/dashboard.megh.html]
@react({ todos, user: user.name })
  import { useState } from "react";

  function App({ todos, user }: { todos: Todo[]; user: string }) {
    const [q, setQ] = useState("");
    const shown = todos.filter((t) => t.title.includes(q));
    return (
      <div style={{ padding: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} />
        <p>{shown.length} todos for {user}</p>
      </div>
    );
  }
@endreact
```

- The block must define a component named `App`, or `export default` one.
- `React` is available without importing it, and `import ... from "react"` works.
- The block body is not parsed as a template, so `{{ }}` is a JSX style object
  there, not an echo. Server data reaches the component only through props,
  which are serialised with the same escaping as `@json`.
- Each block is its own island with its own id. A page can have several.

Compiling JSX needs `@swc/core`:

```sh
npm install @swc/core
```

### Where React comes from

Bare imports are rewritten to URLs, like an import map. By default React 19
loads from [esm.sh](https://esm.sh). Change the URLs to self-host, and add
entries for other packages your components import:

```ts
app.useViews({
  react: {
    imports: {
      react: "/static/vendor/react.mjs",
      "react/jsx-runtime": "/static/vendor/react-jsx-runtime.mjs",
      "react-dom/client": "/static/vendor/react-dom-client.mjs",
      "canvas-confetti": "https://esm.sh/canvas-confetti@1.9.3",
    },
  },
});
```

Relative and absolute URLs (`/static/chart.js`, `https://…`) are left as
they are. Any other bare import is an error at compile time, because the
browser could not load it.

::: tip
Islands render in the browser only. The server sends an empty element, so the
content appears once the scripts load. If your Content Security Policy blocks
inline scripts, allow them for these pages, for example with a nonce.
:::

## Forms

A browser form can only send GET or POST. To reach a PUT, PATCH or DELETE
route, turn on method override and add `@method()` to the form:

```ts [app.ts]
app.useMethodOverride();
```

```html [views/todos/show.megh.html]
<form method="post" action="/todos/{{ todo.id }}">
  @csrf
  @method('DELETE')
  <button>Delete</button>
</form>
```

The form POSTs with a hidden `_method` field, and Megh routes the request to
`@Delete('/:id')`. Only `PUT`, `PATCH` and `DELETE` are accepted, and only from
the body of a form POST: `application/x-www-form-urlencoded` or
`multipart/form-data`. A `_method` in a query string or a JSON body is ignored.

`useMethodOverride()` also parses urlencoded bodies for `@Body()`, unless you
registered a parser for that type yourself. The hidden `_method` and `_token`
fields are removed from the parsed body, so your DTO does not need to declare
them.

### File uploads

For a form with a file input, add `enctype="multipart/form-data"`, call
`app.useMultipart()`, and put `@method()` **before** the file input:

```html
<form method="post" action="/todos/{{ todo.id }}" enctype="multipart/form-data">
  @csrf
  @method('PUT')
  <input name="title" value="{{ todo.title }}">
  <input name="photo" type="file" accept="image/*">
  <button>Save</button>
</form>
```

```ts
@Put('/:id')
async update(@Param('id') id: number, @Body() body: any, @UploadFile('photo') photo: MultipartFile | null) {
  const title = body.title?.value;
  // ...
}
```

To find `_method`, Megh reads only the text fields that come before the first
file, at most 64 KB, and never reads the upload into memory. A `_method` placed
after a file input is ignored, and the request stays a POST.

::: info
On multipart routes `@Body()` holds the `@fastify/multipart` parts
(`body.title.value`), and DTO validation does not run. Validate the fields
yourself; [File Uploads](/advanced/file-uploads) covers saving the file.
:::

## Custom directives

A directive returns JavaScript source. Append to `__out` to print, and use
`__rt.escape()` to escape:

```ts
app
  .getViews()
  .directive("money", (args) => `__out += __rt.escape(formatMoney(${args}));`);
// {{-- in a view --}} @money(order.total)
```

## Scope

- **Includes** see the view's data plus the extras you pass, but not variables
  created inside the template. Inside a loop, write
  `@include('row', { row })`.
- **Components** are isolated: they only see their props and slots.
- **Stacks** render in order. A `@push` that runs after its `@stack` has
  printed won't appear. A page pushing into its layout works, because the
  child renders first.

## Errors

Errors name the template and line, with the original error in `err.cause`:

```
TemplateError: ReferenceError: nope is not defined (home:12)
Unclosed @if (home:4)
```

To see the generated code, use `compileTemplate(src).source`.

## Security

- **Templates are code.** `{{ }}` runs arbitrary JavaScript. Never compile
  templates written by users.
- **Escaping is HTML-only.** `{{ }}` is safe in element text and in quoted
  attributes. It is not safe in `href` (`javascript:` URLs; validate them),
  inside `<script>` (use `@json`), in unquoted attributes or in `style`.
- **Rendering is synchronous.** Load your data before returning the view.

::::
