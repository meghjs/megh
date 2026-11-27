import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeghCompleter } from '../src/complete';
import { formatTemplate } from '../src/format';
import { validate } from '../src/validate';

/** Directive items at `|`, or the kind of result when there are none. */
function directives(src: string) {
  const c = new MeghCompleter();
  const offset = src.indexOf('|');
  const text = src.slice(0, offset) + src.slice(offset + 1);
  const lines = text.slice(0, offset).split('\n');
  const r = c.complete('file:///t', text, { line: lines.length - 1, character: lines[lines.length - 1].length });
  if (r?.type !== 'directive') return r?.type ?? null;
  return [...r.items].sort((a, b) => a.sortText.localeCompare(b.sortText));
}

const labels = (src: string) => {
  const items = directives(src);
  return Array.isArray(items) ? items.map((i) => i.label) : items;
};
const item = (src: string, label: string) => {
  const items = directives(src);
  assert.ok(Array.isArray(items), `no directive items for ${src}`);
  const found = items.find((i) => i.label === label);
  assert.ok(found, `${label} not offered`);
  return found;
};

test('"@" offers the directives, filtered by what is typed', () => {
  const all = labels('<p>\n@|\n</p>') as string[];
  for (const name of ['@if', '@foreach', '@auth', '@guest', '@can', '@cannot', '@session', '@csrf', '@include']) {
    assert.ok(all.includes(name), name);
  }
  assert.deepEqual(labels('@fo|'), ['@for', '@foreach']);
  assert.deepEqual(labels('@ca|'), ['@can', '@cannot']);
});

test('block directives insert their arguments and closer on their own line', () => {
  assert.equal(item('  @fore|', '@foreach').snippet, '@foreach(${1:items} as ${2:item})\n\t$0\n@endforeach');
  assert.equal(item('@au|', '@auth').snippet, '@auth\n\t$0\n@endauth');
  assert.equal(item('@can|', '@can').snippet, "@can('${1:ability}', ${2:subject})\n\t$0\n@endcan");
  assert.equal(item('@sess|', '@session').snippet, "@session('${1:status}')\n\t$0\n@endsession");
  assert.equal(item('@cs|', '@csrf').snippet, '@csrf');
  // Inline (after other text): no closer, just the directive.
  assert.equal(item('<input @i|', '@if').snippet, '@if(${1:condition})');
  // Already followed by "(": the name alone.
  assert.equal(item('@fo|(items as item)', '@foreach').snippet, '@foreach');
});

test('closers and branches follow the open blocks', () => {
  assert.deepEqual(labels('@e|'), ['@extends']);
  const inForeach = labels('@foreach(a as b)\n  @if(x)\n  @endif\n  @e|') as string[];
  assert.equal(inForeach[0], '@endforeach');
  assert.ok(!inForeach.includes('@endif'));
  assert.ok(!inForeach.includes('@else'));

  const inAuth = directives('@auth\n  x\n@|') as any[];
  assert.equal(inAuth[0].label, '@endauth');
  assert.equal(inAuth[0].preselect, true);
  assert.ok(inAuth.some((i) => i.label === '@else'));

  // Innermost first, outer closers still offered.
  assert.deepEqual(labels('@can(\'x\')\n@guest\n@end|'), ['@endguest', '@endcan']);
});

test('no directive items where "@" is not a directive', () => {
  assert.equal(labels('mail me at support@exa|'), 'html');
  assert.equal(labels('{{ a @b| }}'), 'code');
  assert.equal(labels('@@i|'), 'html');
  assert.equal(labels('<style>\n@med|\n</style>'), 'html');
  // Inside directive arguments it's code completion.
  assert.notEqual(labels('@if(@x|)'), 'directive');
});

test('validation and formatting know the auth blocks', () => {
  const problems = (src: string) => validate(src).map((p) => p.message);
  assert.deepEqual(problems("@auth a @else b @endauth @guest c @endguest @can('x', y) d @else e @endcan @cannot('x') f @endcannot @session('s') {{ value }} @endsession"), []);
  assert.deepEqual(problems('@auth x'), ['@auth is not closed with @endauth']);
  assert.deepEqual(problems('@endcan'), ['@endcan without @can']);
  assert.equal(
    formatTemplate('<nav>\n@auth\n<a>Out</a>\n@else\n<a>In</a>\n@endauth\n</nav>', { tabSize: 2, insertSpaces: true }),
    '<nav>\n  @auth\n    <a>Out</a>\n  @else\n    <a>In</a>\n  @endauth\n</nav>',
  );
});
