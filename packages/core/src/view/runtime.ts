import { TemplateError } from "./errors";
import { requestContext } from "../observability/request-context";
import { currentSession } from "../http/session";
import { gate } from "../security/gate";

/** Marks a string as already-safe HTML so `{{ }}` does not escape it again. */
export class HtmlString {
  readonly value: string;
  constructor(value: unknown) {
    this.value = String(value ?? "");
  }
  toString() {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;",
};

/** HTML-escapes a value. `null`, `undefined` and `false` print nothing. */
export function escapeHtml(value: unknown): string {
  if (value == null || value === false) return "";
  if (value instanceof HtmlString) return value.value;
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

// <, > and & could close a <script> tag; U+2028/U+2029 end a line in JS strings.
const SCRIPT_UNSAFE = new RegExp(
  `[<>&${String.fromCharCode(0x2028, 0x2029)}]`,
  "g",
);

// Placeholder that @parent leaves inside a child section; filled in when the layout defines it.
const PARENT = "\u0000@parent\u0000";

/** What a `RenderContext` needs from the engine. */
export interface TemplateRenderer {
  renderTemplate(
    name: string,
    data: Record<string, unknown>,
    ctx: RenderContext,
  ): string;
}

/** The `loop` variable inside `@foreach`, like Blade's `$loop`. */
export type LoopInfo = {
  index: number;
  iteration: number;
  remaining: number;
  count: number;
  first: boolean;
  last: boolean;
  even: boolean;
  odd: boolean;
  depth: number;
  parent: LoopInfo | null;
};

/**
 * One RenderContext per top-level render. It is the `__rt` object compiled
 * templates call into, and it carries state shared across the whole layout
 * chain (sections, stacks), so a child view can fill slots in its layout.
 */
export class RenderContext {
  readonly sections = new Map<string, string>();
  readonly stacks = new Map<string, string[]>();
  depth = 0;
  private ids = 0;
  readonly PARENT = PARENT;

  constructor(private readonly engine: TemplateRenderer) {}

  /** `@auth` / `@guest`: is the request being rendered for a logged-in user? */
  authenticated() {
    return requestContext.user != null;
  }

  /** `@can` / `@cannot`: does the request's user pass the gate? */
  can(name: string, ...args: unknown[]) {
    return gate.allows(name, ...args);
  }

  /** `@session('key')`: a value from the current request's session. */
  sessionValue(key: string) {
    return currentSession()?.get(key);
  }

  // ----- output -----
  escape(value: unknown) {
    return escapeHtml(value);
  }

  raw(value: unknown) {
    return value == null ? "" : String(value);
  }

  html(value: unknown) {
    return new HtmlString(value);
  }

  /** JSON that is safe to drop inside a `<script>` tag. */
  json(value: unknown) {
    return JSON.stringify(value ?? null).replace(
      SCRIPT_UNSAFE,
      (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
    );
  }

  /** An id unique within this render, e.g. for `@react` mount points. */
  nextId(prefix: string) {
    return `${prefix}-${this.ids++}`;
  }

  // ----- conditionals / loops -----
  isset(read: () => unknown) {
    try {
      const v = read();
      return v !== undefined && v !== null;
    } catch (err) {
      if (err instanceof ReferenceError || err instanceof TypeError) {
        return false;
      }
      throw err;
    }
  }

  /** Normalises anything iterable into `[key, value]` pairs for `@foreach`. */
  entries(x: unknown): [unknown, unknown][] {
    if (x == null) return [];
    if (Array.isArray(x)) return x.map((v, i) => [i, v]);
    if (x instanceof Map) return [...x.entries()];
    if (
      typeof (x as { [Symbol.iterator]?: unknown })[Symbol.iterator] ===
      "function"
    ) {
      return [...(x as Iterable<unknown>)].map((v, i) => [i, v]);
    }
    if (typeof x === "object") return Object.entries(x as object);
    throw new TypeError(`@foreach cannot iterate over a ${typeof x}`);
  }

  loop(index: number, count: number, parent: LoopInfo | null): LoopInfo {
    return {
      index,
      iteration: index + 1,
      remaining: count - index - 1,
      count,
      first: index === 0,
      last: index === count - 1,
      even: (index + 1) % 2 === 0,
      odd: (index + 1) % 2 === 1,
      depth: parent ? parent.depth + 1 : 1,
      parent,
    };
  }

  // ----- composition -----
  render(name: string, data: Record<string, unknown>) {
    return this.engine.renderTemplate(name, data, this);
  }

  include(
    data: Record<string, unknown>,
    name: string,
    extra: Record<string, unknown> = {},
  ) {
    return this.render(name, { ...data, ...extra });
  }

  /** Components get an isolated scope: only their props and slots, not the caller's data. */
  component(
    name: string,
    props: Record<string, unknown>,
    slots: Record<string, HtmlString>,
  ) {
    return this.render(`components.${name}`, { ...props, ...slots });
  }

  // ----- sections (the child renders first, so the first definition wins) -----
  setSection(name: string, content: string) {
    const existing = this.sections.get(name);
    if (existing === undefined) this.sections.set(name, content);
    else if (existing.includes(PARENT)) {
      this.sections.set(name, existing.replaceAll(PARENT, content));
    }
  }

  yieldSection(name: string, fallback: unknown = "") {
    return this.sections.get(name) ?? escapeHtml(fallback);
  }

  // ----- stacks -----
  pushStack(name: string, content: string) {
    let list = this.stacks.get(name);
    if (!list) this.stacks.set(name, (list = []));
    list.push(content);
  }

  stack(name: string) {
    return (this.stacks.get(name) ?? []).join("");
  }

  // ----- errors -----
  wrapError(err: unknown, template: string, line: number) {
    // Already points at the innermost template.
    if (err instanceof TemplateError) return err;
    const e = err as Error;
    return new TemplateError(`${e?.name ?? "Error"}: ${e?.message ?? e}`, {
      template,
      line,
      cause: err,
    });
  }
}

/** Removes `@parent` placeholders a layout never filled. */
export function stripPlaceholders(html: string) {
  return html.replaceAll(PARENT, "");
}
