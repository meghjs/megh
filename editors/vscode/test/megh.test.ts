import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MeghCompleter } from '../src/complete';
import { scanComponents } from '../src/components';
import { formatTemplate } from '../src/format';
import { objectKeys, ProjectIndex } from '../src/project';
import { validate } from '../src/validate';

const VIEWS = '/app/views';
const at = (p: string) => path.join(VIEWS, p);

// A tiny app: two controllers, a layout, a page, a partial, a component.
const index = new ProjectIndex(
  VIEWS,
  [
    { path: at('layouts/app.megh.html'), text: '<title>{{ appName }}</title>@yield(\'content\')' },
    { path: at('todos/show.megh.html'), text: "@extends('layouts.app')\n@section('content'){{ todo.title }} {{ todo.done }}@include('partials.nav')@endsection" },
    { path: at('todos/index.megh.html'), text: '@foreach(todos as todo){{ todo.owner }}@endforeach' },
    { path: at('partials/nav.megh.html'), text: '<nav>{{ user?.name }}</nav>' },
    { path: at('components/alert.megh.html'), text: '<div class="{{ type }}">{{ title }} {{ slot }}</div>' },
  ],
  [
    {
      path: '/app/src/todo.controller.ts',
      text: [
        "return view('todos.show', { todo, errors: {}, 'old': x, ...rest, fn() {} }).header('a', 'b');",
        "return Results.View('todos.index', { todos: this.todos.all(filter), filter }, 200);",
      ].join('\n'),
    },
    { path: '/app/src/app.ts', text: "app.getViews().share('appName', 'Demo');" },
  ],
);

/** Megh items at `|`: labels, or null. */
function code(src: string, view?: string) {
  const c = new MeghCompleter([], { index });
  const offset = src.indexOf('|');
  const text = src.slice(0, offset) + src.slice(offset + 1);
  const lines = text.slice(0, offset).split('\n');
  const r = c.complete('file:///t', text, { line: lines.length - 1, character: lines[lines.length - 1].length }, view);
  return r?.type === 'code' ? r.items.map((i) => i.label) : r === null ? null : 'html';
}

function hover(src: string, view?: string) {
  const c = new MeghCompleter([], { index });
  const offset = src.indexOf('|');
  const text = src.slice(0, offset) + src.slice(offset + 1);
  const lines = text.slice(0, offset).split('\n');
  const r = c.hover('file:///t', text, { line: lines.length - 1, character: lines[lines.length - 1].length }, view);
  if (!r) return null;
  if (r.type === 'code') return r.hover.markdown;
  const c0 = r.hover.contents as any;
  return Array.isArray(c0) ? c0.map((x: any) => x.value ?? x).join('\n') : c0.value ?? String(c0);
}

// ---------- project index ----------

test('object literal keys', () => {
  const src = "x({ a, b: f(1, 2), 'c': [1, 2], ...d, e() {}, g: { h: 1 } })";
  assert.deepEqual(objectKeys(src, src.indexOf('{')), ['a', 'b', 'c', 'g']);
});

test('view variables come from controllers, shared data, and the views that use a layout or partial', () => {
  const keys = (v: string) => [...index.variablesFor(v).keys()].sort();
  assert.deepEqual(keys('todos.show'), ['appName', 'errors', 'old', 'todo']);
  assert.deepEqual(keys('todos.index'), ['appName', 'filter', 'todos']);
  // A layout gets what its pages get; a partial what its includers get.
  assert.ok(keys('layouts.app').includes('todo'));
  assert.ok(keys('partials.nav').includes('errors'));
  // A component only its props and slot, not shared data.
  assert.deepEqual(keys('components.alert'), ['slot', 'title', 'type']);
  assert.match(index.variablesFor('todos.show').get('todo')!.detail, /todo\.controller\.ts:1/);
});

// ---------- completion inside Megh code ----------

test('variables inside {{ }} and directive arguments', () => {
  assert.deepEqual((code('{{ | }}', 'todos.show') as string[]).slice().sort(), ['appName', 'errors', 'old', 'todo']);
  assert.ok((code('@if(t|)', 'todos.show') as string[]).includes('todo'));
  assert.ok((code('{!! | !!}', 'todos.index') as string[]).includes('todos'));
});

test('@foreach, @for and @js variables are in scope after they are declared', () => {
  const src = '@foreach(todos as todo)\n  @for(let i = 0; i < 2; i++) {{ | }} @endfor\n@endforeach';
  const items = code(src, 'todos.index') as string[];
  for (const v of ['todo', 'loop', 'i', 'todos', 'filter']) assert.ok(items.includes(v), v);
  // After @endforeach the loop variable is gone.
  const after = code('@foreach(todos as todo) @endforeach {{ | }}', 'todos.index') as string[];
  assert.ok(!after.includes('todo') && !after.includes('loop'));
  assert.ok((code('@js(const total = 3) {{ | }}') as string[]).includes('total'));
  assert.deepEqual((code('@foreach(obj as key => value) {{ | }} @endforeach') as string[]).slice().sort(), ['key', 'loop', 'value']);
});

test('members: loop properties, and properties used elsewhere in templates', () => {
  assert.ok((code('@foreach(a as b) {{ loop.| }} @endforeach') as string[]).includes('iteration'));
  assert.deepEqual(code('{{ todo.| }}', 'todos.show'), ['done', 'owner', 'title']);
  assert.deepEqual(code('{{ user?.| }}'), ['name']);
});

test('view, component and section names in directive arguments', () => {
  assert.deepEqual(code("@include('|')"), ['layouts.app', 'partials.nav', 'todos.index', 'todos.show']);
  assert.deepEqual(code("@extends('lay|')"), ['layouts.app', 'partials.nav', 'todos.index', 'todos.show']);
  assert.deepEqual(code("@component('|')"), ['alert']);
  assert.deepEqual(code("@section('|')"), ['content']);
});

test('no completion in comments, strings, or a new @foreach variable name', () => {
  assert.equal(code('{{-- | --}}'), null);
  assert.equal(code("{{ 'abc|' }}"), null);
  assert.equal(code('@foreach(todos as t|)'), null);
  assert.equal(code('<p |'), 'html');
});

// ---------- hover ----------

test('hover: directives, variables, loop, HTML and components', () => {
  assert.match(hover('@fore|ach(a as b) @endforeach')!, /Loops over arrays/);
  assert.match(hover('|@csrf')!, /_token/);
  assert.match(hover('@upp|er(x)')!, /custom directive/);
  assert.match(hover('{{ to|do.title }}', 'todos.show')!, /view data, todo\.controller\.ts:1/);
  assert.match(hover('@foreach(a as b) {{ loop.firs|t }} @endforeach')!, /first item/);
  assert.match(hover('@foreach(items as it) {{ i|t }} @endforeach')!, /@foreach\(items as it\)/);
  assert.match(hover('<inp|ut type="text">')!, /input/i);
  assert.equal(hover('{{ "str|ing" }}'), null);

  const demo = path.resolve(__dirname, '../../../.internal/view-demo/views');
  const c = new MeghCompleter(scanComponents(demo));
  const h = c.hover('file:///t', '<x-alert type="info">', { line: 0, character: 4 });
  assert.ok(h && h.type === 'html');
  assert.match(JSON.stringify(h.hover.contents), /components\/alert\.megh\.html.*Props: `title`, `type`/);
});

// ---------- validation ----------

const problems = (src: string, components?: string[]) =>
  validate(src, { components: components && new Set(components) }).map((p) => `${p.severity}: ${p.message}`);

test('validation: valid templates have no problems', () => {
  assert.deepEqual(problems('<div>@if(a)<p>x</p>@elseif(b)<br>@else<img src="">@endif</div>'), []);
  // Branches open the same tag differently; one closing tag after @endif.
  assert.deepEqual(problems('@if(a)<div class="a">@else<div class="b">@endif\n  x\n</div>'), []);
  // Optional end tags, void elements, self-closing components, slots.
  assert.deepEqual(problems('<ul><li>a<li>b</ul><p>c<x-badge :label="t" /><x-alert><x-slot:title>T</x-slot>b</x-alert>', ['alert', 'badge']), []);
  // One-line @section, @section ... @show, @js(...) and Megh code with < >.
  assert.deepEqual(problems("@section('t', 'T')@section('s')x @show @js(const a = 1 < 2) {{ a > b }}"), []);
});

test('validation: Megh structure errors', () => {
  assert.deepEqual(problems('@if(a) x'), ['error: @if is not closed with @endif']);
  assert.deepEqual(problems('x @endif'), ['error: @endif without @if']);
  assert.deepEqual(problems('@else'), ['error: @else outside @if, @unless, @isset, @auth, @guest, @can or @cannot']);
  assert.deepEqual(problems('@isset(a) x @elseif(b) y @else z @endisset'), []);
  assert.match(problems('@foreach(a as b) @if(c) @endforeach')[0], /@endforeach found, but @if \(line 1\) is still open/);
  assert.deepEqual(problems('<p>{{ name </p>'), ['error: `{{` is not closed with `}}`']);
  assert.deepEqual(problems('@if(a(b) x @endif'), ['error: `@if(` is missing its closing `)`']);
  assert.deepEqual(problems('@section(\'content\') x'), ['error: @section is not closed with @endsection']);
});

test('validation: HTML problems are warnings', () => {
  assert.deepEqual(problems('<div><span>x</div>'), ['warning: <span> is not closed']);
  assert.deepEqual(problems('<div>x</div></section>'), ['warning: </section> has no matching <section>']);
  assert.deepEqual(problems('<input type="a" TYPE="b">'), ['warning: Duplicate attribute "type" on <input>']);
  assert.deepEqual(problems('<x-nope />', ['alert']), [
    'warning: No component file for <x-nope>: expected components/nope.megh.html',
  ]);
  assert.deepEqual(problems('<main>'), ['warning: <main> is not closed']);
});

test('validation: the demo app and core fixtures are clean', () => {
  const roots = ['../../../.internal/view-demo/views', '../../../packages/core/src/view/__fixtures__/views'];
  for (const root of roots.map((r) => path.resolve(__dirname, r))) {
    const components = new Set(scanComponents(root).map((t) => t.name.slice(2)));
    for (const file of walk(root)) {
      assert.deepEqual(validate(fs.readFileSync(file, 'utf8'), { components }), [], file);
    }
  }
});

// ---------- formatting ----------

const fmt = (src: string) => formatTemplate(src, { tabSize: 2, insertSpaces: true, wrapLineLength: 120 });

test('formatting indents HTML and block directives', () => {
  const src = [
    "@extends('layouts.app')",
    "@section('title', 'Todos')",
    "@section('content')",
    '<ul>',
    '@foreach(todos as todo)',
    '<li class="{{ todo.done ? \'done\' : \'\' }}">',
    '@if(todo.done)',
    '<s>{{ todo.title }}</s>',
    '@else',
    '{{ todo.title }}',
    '@endif',
    '</li>',
    '@endforeach',
    '</ul>',
    '@endsection',
    '',
  ].join('\n');
  assert.equal(
    fmt(src),
    [
      "@extends('layouts.app')",
      "@section('title', 'Todos')",
      "@section('content')",
      '  <ul>',
      '    @foreach(todos as todo)',
      '      <li class="{{ todo.done ? \'done\' : \'\' }}">',
      '        @if(todo.done)',
      '          <s>{{ todo.title }}</s>',
      '        @else',
      '          {{ todo.title }}',
      '        @endif',
      '      </li>',
      '    @endforeach',
      '  </ul>',
      '@endsection',
      '',
    ].join('\n'),
  );
});

test('formatting keeps inline directives, scripts and @js bodies as written', () => {
  const src = [
    '<div>',
    '<p>@foreach(tags as t)<b>{{ t }}</b>@endforeach</p>',
    '<input @if(on) checked @endif name="x">',
    '<script>',
    'window.todos = @json(todos);',
    '</script>',
    '@js',
    '   const keep   =   "my spacing";',
    '@endjs',
    '</div>',
  ].join('\n');
  const out = fmt(src)!;
  assert.ok(out.includes('  <p>@foreach(tags as t)<b>{{ t }}</b>@endforeach</p>'), out);
  assert.ok(out.includes('  <input @if(on) checked @endif name="x">'), out);
  assert.ok(out.includes('    window.todos = @json(todos);'), out);
  assert.ok(out.includes('   const keep   =   "my spacing";'), out);
});

test('formatting refuses broken templates', () => {
  assert.equal(fmt('<p>{{ open </p>'), null);
  assert.equal(fmt('@if(a)\n<p>x</p>\n'), null);
});

test('formatting is stable and changes only whitespace on the demo app and core fixtures', () => {
  const roots = ['../../../.internal/view-demo/views', '../../../packages/core/src/view/__fixtures__/views'];
  for (const root of roots.map((r) => path.resolve(__dirname, r))) {
    for (const file of walk(root)) {
      const src = fs.readFileSync(file, 'utf8');
      const once = fmt(src);
      assert.ok(once !== null, `refused ${file}`);
      assert.equal(fmt(once), once, `not stable: ${file}`);
      assert.equal(once.replace(/\s+/g, ''), src.replace(/\s+/g, ''), file);
    }
  }
});

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith('.megh.html')) yield full;
  }
}
