import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import {
  HtmlString,
  TemplateError,
  ViewEngine,
  compileTemplate,
} from "./index";
import { requestContext } from "../observability/request-context";
import { MeghSession, SESSION_CONTEXT_KEY } from "../http/session";

const root = path.join(__dirname, "__fixtures__", "views");
const engine = new ViewEngine({ root, cache: true }).share("appName", "Megh");
const r = (src: string, data?: Record<string, unknown>) =>
  engine.renderString(src, data);

describe("ViewEngine", () => {
  it("escapes {{ }} and leaves {!! !!} raw", () => {
    expect(r("{{ x }}|{!! x !!}", { x: "<b>\"hi\"</b>" })).toBe(
      "&lt;b&gt;&quot;hi&quot;&lt;/b&gt;|<b>\"hi\"</b>",
    );
    expect(r("[{{ missing ?? \"\" }}][{{ n }}]", { missing: null, n: 0 })).toBe(
      "[][0]",
    );
    expect(r("{{ h }}", { h: new HtmlString("<i>ok</i>") })).toBe("<i>ok</i>");
  });

  it("handles comments, escapes and emails", () => {
    expect(r("a{{-- gone --}}b @{{ vue }} @@if mail@if.com")).toBe(
      "ab {{ vue }} @if mail@if.com",
    );
    // Unregistered names such as CSS at-rules stay text.
    expect(r("@media (x) {}")).toBe("@media (x) {}");
  });

  it("leaves <x-component> tags inside comments alone", () => {
    expect(r("a{{-- use <x-alert>hi</x-alert> --}}b")).toBe("ab");
    expect(
      r("{{-- <x-slot:title>T</x-slot> and <x-badge/> --}}<p>ok</p>"),
    ).toBe("<p>ok</p>");
    // Tags outside the comment still compile.
    expect(r("{{-- <x-alert> --}}<x-alert type=\"info\">hi</x-alert>")).toMatch(
      /<div class="alert alert-info">[\s\S]*hi/,
    );
    // An unterminated comment is still reported, not closed by a rewritten tag.
    expect(() => r("a{{-- <x-alert>hi</x-alert>")).toThrow(TemplateError);
  });

  it("supports if / elseif / else / unless / isset", () => {
    const src = "@if(n > 1)many @elseif(n === 1)one @else none @endif";
    expect(r(src, { n: 5 })).toBe("many ");
    expect(r(src, { n: 1 })).toBe("one ");
    expect(r(src, { n: 0 })).toBe(" none ");
    expect(r("@unless(ok)no @endunless", { ok: false })).toBe("no ");
    expect(r("@isset(user.profile.bio)yes @endisset-", { user: {} })).toBe("-");
    // @isset takes @else and @elseif, as in Blade.
    const isset = "@isset(href)link @elseif(title)title @else plain @endisset";
    expect(r(isset, { href: "/" })).toBe("link ");
    expect(r(isset, { title: "T" })).toBe("title ");
    expect(r(isset, { title: "" })).toBe(" plain ");
    expect(() => r("@isset(a)x @else y @else z @endisset")).toThrow(
      /Duplicate @else/,
    );
    // Like Blade, a directive glued to a word is plain text.
    expect(r("a@if(true)", {})).toBe("a@if(true)");
    // Parens and strings inside directive arguments.
    expect(r("@if(f(\")\"))y @endif", { f: (s: string) => s === ")" })).toBe(
      "y ",
    );
  });

  it("loops with foreach, the loop variable, keys, nesting and break", () => {
    expect(
      r("@foreach(xs as x){{ x }}{{ loop.last ? \"\" : \",\" }}@endforeach", {
        xs: [1, 2, 3],
      }),
    ).toBe("1,2,3");
    expect(
      r("@foreach(o as k => v){{ k }}={{ v }};@endforeach", {
        o: { a: 1, b: 2 },
      }),
    ).toBe("a=1;b=2;");
    expect(
      r("@foreach(m as k => v){{ k }}{{ v }}@endforeach", {
        m: new Map([["x", 1]]),
      }),
    ).toBe("x1");
    expect(
      r(
        "@foreach(rows as row)@foreach(row as c){{ loop.depth }}{{ loop.parent.index }}@endforeach @endforeach",
        { rows: [[1], [2]] },
      ),
    ).toBe("20 21 ");
    expect(
      r("@foreach(xs as x)@break(x > 2){{ x }}@endforeach", {
        xs: [1, 2, 3, 4],
      }),
    ).toBe("12");
    expect(r("@for(let i = 0; i < 3; i++){{ i }}@endfor")).toBe("012");
  });

  it("runs @js blocks and inline @js", () => {
    expect(
      r("@js const t = a + b; @endjs{{ t }} @js(let y = t * 2){{ y }}", {
        a: 1,
        b: 2,
      }),
    ).toBe("3 6");
  });

  it("emits @json that is safe inside <script>", () => {
    const out = r("@json(v)", { v: { s: "</script>\u2028" } });
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("\u2028");
    expect(JSON.parse(out)).toEqual({ s: "</script>\u2028" });
  });

  it("renders @csrf and @method", () => {
    expect(r("@csrf", { csrfToken: "a\"b" })).toBe(
      "<input type=\"hidden\" name=\"_token\" value=\"a&quot;b\">",
    );
    expect(r("@method('PUT')")).toBe(
      "<input type=\"hidden\" name=\"_method\" value=\"PUT\">",
    );
  });

  it("composes layouts, sections, @parent, @show, stacks, includes and components", () => {
    const html = engine.render("home", {
      user: { name: "Ana <3" },
      todos: [
        { title: "Write engine", done: true },
        { title: "Ship it", done: false },
      ],
    });
    expect(html).toMatch(/<title>Home<\/title>/);
    expect(html).toMatch(/<nav>Megh \| Ana &lt;3<\/nav>/);
    expect(html).toMatch(/Default sidebar<\/aside>\s*<aside>Extra links/);
    expect(html).toMatch(/<h1>Hello, Ana &lt;3<\/h1>/);
    expect(html).toMatch(
      /alert-warning[\s\S]*<strong>Heads up<\/strong>[\s\S]*You have 2 todos/,
    );
    expect(html).toMatch(/<li class="first">1. Write engine ✓<\/li>/);
    expect(html).toMatch(/<li class="">2. Ship it<\/li>/);
    expect(html).toMatch(/support@example.com · Vue: \{\{ msg \}\}/);
    expect(html).toMatch(/window.todos = \[\{"title":"Write engine"/);
    expect(html).not.toMatch(/this comment/);
    expect(html).not.toContain("\u0000");
  });

  it("keeps directives glued to component tags working", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "megh-views-"));
    try {
      fs.mkdirSync(path.join(dir, "components"));
      fs.writeFileSync(
        path.join(dir, "components", "badge.megh.html"),
        "[{{ label }}{{ slot }}]",
      );
      const e = new ViewEngine({ root: dir });
      expect(
        e.renderString(
          "@foreach(xs as x)<x-badge :label=\"x\" />@endforeach|@if(true)<x-badge label=\"b\">s</x-badge>@endif|<x-badge label=\"c\"></x-badge>(note)",
          { xs: [1, 2] },
        ),
      ).toBe("[1][2]|[bs]|[c](note)");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("registers custom directives", () => {
    const e = new ViewEngine({ root });
    e.directive(
      "upper",
      (args) => `__out += __rt.escape(String(${args}).toUpperCase());`,
    );
    expect(e.renderString("@upper(name)", { name: "megh" })).toBe("MEGH");
  });

  it("points errors at the template and line", () => {
    expect(() => r("a\n@if(x)\nb")).toThrow(/Unclosed @if \(inline:2\)/);
    try {
      r("ok\n\n{{ nope.deep }}");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(TemplateError);
      expect((e as TemplateError).line).toBe(3);
      expect((e as Error).message).toMatch(/ReferenceError/);
    }
    expect(() => r("@endif")).toThrow(/@endif without matching @if/);
    expect(() => r("@foreach(xs)@endforeach")).toThrow(/@foreach expects/);
    expect(() => engine.render("../secret")).toThrow(/Invalid view name/);
    expect(() => engine.render("missing.page")).toThrow(/not found/);
  });

  it("exposes the generated source", () => {
    expect(compileTemplate("{{ a }}").source).toContain("__rt.escape(a)");
  });

  describe("caching", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "megh-views-"));
    const file = path.join(dir, "page.megh.html");
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    const rewrite = (content: string, mtime: number) => {
      fs.writeFileSync(file, content);
      fs.utimesSync(file, mtime, mtime);
    };

    it("recompiles changed files when cache is off", () => {
      const e = new ViewEngine({ root: dir, cache: false });
      rewrite("one", 1000);
      expect(e.render("page")).toBe("one");
      rewrite("two", 2000);
      expect(e.render("page")).toBe("two");
    });

    it("keeps the first compile when cache is on", () => {
      const e = new ViewEngine({ root: dir, cache: true });
      rewrite("one", 3000);
      expect(e.render("page")).toBe("one");
      rewrite("two", 4000);
      expect(e.render("page")).toBe("one");
    });
  });

  it("stops recursive includes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "megh-views-"));
    try {
      fs.writeFileSync(path.join(dir, "loop.megh.html"), "@include('loop')");
      const e = new ViewEngine({ root: dir, maxDepth: 5 });
      expect(() => e.render("loop")).toThrow(/nesting deeper than 5/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("@auth, @guest and @session", () => {
  const tpl = "@auth in @else out @endauth|@guest g @endguest";

  it("follow the request's authenticated user, not the view data", () => {
    expect(r(tpl, { user: { id: 1 } }).replace(/\s+/g, " ")).toBe(" out | g ");
    const html = requestContext.run(() => r(tpl), { user: { id: 1 } });
    expect(html.replace(/\s+/g, " ")).toBe(" in |");
  });

  it("@session prints a session value as `value`, escaped", () => {
    const session = new MeghSession(null, null).set("status", "<b>ok</b>");
    const html = requestContext.run(
      () =>
        r(
          "@session('status')[{{ value }}]@endsession @session('none')x @endsession",
        ),
      { values: [[SESSION_CONTEXT_KEY, session]] },
    );
    expect(html.trim()).toBe("[&lt;b&gt;ok&lt;/b&gt;]");
    expect(r("@session('status')x @endsession")).toBe("");
  });

  it("reject arguments and unbalanced blocks", () => {
    expect(() => r("@auth('admin') x @endauth")).toThrow(/takes no arguments/);
    expect(() => r("@guest x @endauth")).toThrow(TemplateError);
    expect(() => r("@session x @endsession")).toThrow(TemplateError);
  });
});
