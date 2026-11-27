import { splitArgs } from "./scan";
import type { DirectiveToken } from "./lexer";
import type { TemplateError } from "./errors";

/** An open block (`@if`, `@foreach`, `@section` ...) on the compiler's stack. */
export type BlockFrame = {
  tag: string;
  line: number;
  hasElse?: boolean;
  /** Generated variable holding the block's name or component record. */
  v?: string;
};

/** Helpers the compiler hands to every directive. */
export type CompilerContext = {
  readonly stack: BlockFrame[];
  /** A fresh variable name for generated code. */
  id(): string;
  error(message: string, token: DirectiveToken): TemplateError;
  /** Returns `args`, or throws when the directive was written without them. */
  expect(args: string | null, token: DirectiveToken): string;
  open(token: DirectiveToken, extra?: Partial<BlockFrame>): BlockFrame;
  /** The innermost open block, which must be one of `tags`. */
  peek(tags: string[], token: DirectiveToken): BlockFrame;
  close(tags: string[], token: DirectiveToken): BlockFrame;
  /** The innermost open block with this tag, if any. */
  find(tag: string): BlockFrame | undefined;
};

/**
 * A directive turns `@name(args)` into JavaScript source.
 *
 *   args  the text inside the parentheses, or null when there are none
 *   ctx   compiler helpers: open/peek/close block frames, unique ids, errors
 *
 * Generated code can use `__out` (output buffer), `__buffers` (capture stack),
 * `__data` (template data), `__parent` (layout name) and `__rt` (runtime).
 */
export type DirectiveHandler = (
  args: string | null,
  ctx: CompilerContext,
  token: DirectiveToken,
) => string;

const IDENT = "[A-Za-z_$][\\w$]*";
const FOREACH = new RegExp(
  `^([\\s\\S]+?)\\s+as\\s+(?:(${IDENT})\\s*=>\\s*)?(${IDENT})$`,
);

/** Starts capturing output into a fresh buffer; the closing directive restores it. */
const startCapture = () => "__buffers.push(__out); __out = '';";

export const builtinDirectives: ReadonlyMap<string, DirectiveHandler> = new Map<
  string,
  DirectiveHandler
>(
  Object.entries({
    // ---------- conditionals ----------
    if: (a, ctx, t) => {
      ctx.open(t);
      return `if (${ctx.expect(a, t)}) {`;
    },
    elseif: (a, ctx, t) => {
      const f = ctx.peek(
        ["if", "unless", "isset", "auth", "guest", "can", "cannot"],
        t,
      );
      if (f.hasElse) throw ctx.error("@elseif after @else", t);
      return `} else if (${ctx.expect(a, t)}) {`;
    },
    else: (a, ctx, t) => {
      const f = ctx.peek(
        ["if", "unless", "isset", "auth", "guest", "can", "cannot"],
        t,
      );
      if (f.hasElse) throw ctx.error("Duplicate @else", t);
      f.hasElse = true;
      return "} else {";
    },
    endif: (a, ctx, t) => {
      ctx.close(["if"], t);
      return "}";
    },
    unless: (a, ctx, t) => {
      ctx.open(t);
      return `if (!(${ctx.expect(a, t)})) {`;
    },
    endunless: (a, ctx, t) => {
      ctx.close(["unless"], t);
      return "}";
    },
    isset: (a, ctx, t) => {
      ctx.open(t);
      return `if (__rt.isset(() => (${ctx.expect(a, t)}))) {`;
    },
    endisset: (a, ctx, t) => {
      ctx.close(["isset"], t);
      return "}";
    },

    // ---------- authentication ----------
    // @auth ... @else ... @endauth: the user `useAuthentication()` resolved
    // for this request, whatever the view data holds.
    auth: (a, ctx, t) => {
      if (a !== null) throw ctx.error("@auth takes no arguments", t);
      ctx.open(t);
      return "if (__rt.authenticated()) {";
    },
    endauth: (a, ctx, t) => {
      ctx.close(["auth"], t);
      return "}";
    },
    guest: (a, ctx, t) => {
      if (a !== null) throw ctx.error("@guest takes no arguments", t);
      ctx.open(t);
      return "if (!__rt.authenticated()) {";
    },
    endguest: (a, ctx, t) => {
      ctx.close(["guest"], t);
      return "}";
    },

    // ---------- gates ----------
    // @can('edit-post', post) ... @else ... @endcan, with gates from app.defineGate().
    can: (a, ctx, t) => {
      ctx.open(t);
      return `if (__rt.can(${ctx.expect(a, t)})) {`;
    },
    endcan: (a, ctx, t) => {
      ctx.close(["can"], t);
      return "}";
    },
    cannot: (a, ctx, t) => {
      ctx.open(t);
      return `if (!__rt.can(${ctx.expect(a, t)})) {`;
    },
    endcannot: (a, ctx, t) => {
      ctx.close(["cannot"], t);
      return "}";
    },

    // ---------- session ----------
    // @session('status') <p>{{ value }}</p> @endsession: only when the
    // session (flashed values included) holds the key.
    session: (a, ctx, t) => {
      const v = ctx.id();
      ctx.open(t);
      return `{ const ${v} = __rt.sessionValue(${ctx.expect(a, t)}); if (${v} != null) { const value = ${v};`;
    },
    endsession: (a, ctx, t) => {
      ctx.close(["session"], t);
      return "}}";
    },

    // ---------- loops ----------
    // @foreach(users as user)  /  @foreach(scores as name => score)
    foreach: (a, ctx, t) => {
      const m = FOREACH.exec(ctx.expect(a, t));
      if (!m) {
        throw ctx.error(
          "@foreach expects \"items as item\" or \"items as key => value\"",
          t,
        );
      }
      const [, expr, key, value] = m;
      const items = ctx.id();
      const i = ctx.id();
      const parent = ctx.id();
      ctx.open(t);
      return `{ const ${items} = __rt.entries(${expr});
const ${parent} = typeof loop === 'undefined' ? null : loop;
for (let ${i} = 0; ${i} < ${items}.length; ${i}++) {
const loop = __rt.loop(${i}, ${items}.length, ${parent});
${key ? `const ${key} = ${items}[${i}][0];` : ""} const ${value} = ${items}[${i}][1];`;
    },
    endforeach: (a, ctx, t) => {
      ctx.close(["foreach"], t);
      return "}}";
    },
    for: (a, ctx, t) => {
      ctx.open(t);
      return `for (${ctx.expect(a, t)}) {`;
    },
    endfor: (a, ctx, t) => {
      ctx.close(["for"], t);
      return "}";
    },
    while: (a, ctx, t) => {
      ctx.open(t);
      return `while (${ctx.expect(a, t)}) {`;
    },
    endwhile: (a, ctx, t) => {
      ctx.close(["while"], t);
      return "}";
    },
    break: (a) => (a ? `if (${a}) break;` : "break;"),
    continue: (a) => (a ? `if (${a}) continue;` : "continue;"),

    // ---------- raw JS ----------
    // Inline: @js(const total = items.length). The block form is handled by the lexer.
    js: (a, ctx, t) => `${ctx.expect(a, t)};`,

    // ---------- React islands ----------
    // @react(props) ... @endreact is captured by the lexer and compiled in
    // compiler.ts; these entries register the names and catch strays.
    react: (a, ctx, t) => {
      throw ctx.error("@react is handled by the lexer", t);
    },
    endreact: (a, ctx, t) => {
      throw ctx.error("@endreact without matching @react", t);
    },

    // ---------- output helpers ----------
    json: (a, ctx, t) => `__out += __rt.json(${ctx.expect(a, t)});`,
    csrf: () =>
      "__out += '<input type=\"hidden\" name=\"_token\" value=\"' + __rt.escape(__data.csrfToken) + '\">';",
    method: (a, ctx, t) =>
      `__out += '<input type="hidden" name="_method" value="' + __rt.escape(${ctx.expect(a, t)}) + '">';`,

    // ---------- includes ----------
    // @include('partials.nav') or @include('partials.row', { item })
    include: (a, ctx, t) =>
      `__out += __rt.include(__data, ${ctx.expect(a, t)});`,

    // ---------- layouts ----------
    extends: (a, ctx, t) => `__parent = ${ctx.expect(a, t)};`,
    yield: (a, ctx, t) => `__out += __rt.yieldSection(${ctx.expect(a, t)});`,
    section: (a, ctx, t) => {
      const [name, value] = splitArgs(ctx.expect(a, t));
      // @section('title', 'Home')
      if (value !== undefined) {
        return `__rt.setSection(${name}, __rt.escape(${value}));`;
      }
      const v = ctx.id();
      ctx.open(t, { v });
      return `const ${v} = ${name}; ${startCapture()}`;
    },
    endsection: (a, ctx, t) => {
      const f = ctx.close(["section"], t);
      return `__rt.setSection(${f.v}, __out); __out = __buffers.pop();`;
    },
    // @section('sidebar') default content @show: define and print in one go (layouts).
    show: (a, ctx, t) => {
      const f = ctx.close(["section"], t);
      return `__rt.setSection(${f.v}, __out); __out = __buffers.pop() + __rt.yieldSection(${f.v});`;
    },
    parent: () => "__out += __rt.PARENT;",

    // ---------- stacks ----------
    push: (a, ctx, t) => {
      const v = ctx.id();
      ctx.open(t, { v });
      return `const ${v} = ${ctx.expect(a, t)}; ${startCapture()}`;
    },
    endpush: (a, ctx, t) => {
      const f = ctx.close(["push"], t);
      return `__rt.pushStack(${f.v}, __out); __out = __buffers.pop();`;
    },
    stack: (a, ctx, t) => `__out += __rt.stack(${ctx.expect(a, t)});`,

    // ---------- components ----------
    // @component('alert', { type: 'error' }) ... @slot('title') ... @endslot ... @endcomponent
    // (<x-alert type="error"> tags are rewritten into these before lexing.)
    component: (a, ctx, t) => {
      const [name, props = "{}"] = splitArgs(ctx.expect(a, t));
      const v = ctx.id();
      ctx.open(t, { v });
      return `const ${v} = { name: ${name}, props: ${props}, slots: {} }; ${startCapture()}`;
    },
    slot: (a, ctx, t) => {
      if (!ctx.find("component"))
        throw ctx.error("@slot outside @component", t);
      const v = ctx.id();
      ctx.open(t, { v });
      return `const ${v} = ${ctx.expect(a, t)}; ${startCapture()}`;
    },
    endslot: (a, ctx, t) => {
      const f = ctx.close(["slot"], t);
      const c = ctx.find("component")!;
      return `${c.v}.slots[${f.v}] = __rt.html(__out); __out = __buffers.pop();`;
    },
    endcomponent: (a, ctx, t) => {
      const f = ctx.close(["component"], t);
      return `${f.v}.slots.slot = __rt.html(__out);
__out = __buffers.pop() + __rt.component(${f.v}.name, ${f.v}.props, ${f.v}.slots);`;
    },
  } satisfies Record<string, DirectiveHandler>),
);
