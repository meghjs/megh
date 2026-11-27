/**
 * Completion for directive names: `@fo|` offers `@foreach`, inserted as a
 * snippet with its arguments and closing directive. Inside an open block,
 * its closer and branches (`@else`, `@endforeach`) come first.
 */
import { BLOCKS, BRANCHES, CLOSERS, DIRECTIVES, opensBlock } from './directives';
import type { Range } from './mask';

export type DirectiveItem = {
  /** `@foreach` */
  label: string;
  /** Snippet text (VS Code / LSP snippet syntax) replacing `start`..cursor. */
  snippet: string;
  detail: string;
  documentation: string;
  /** Offset of the `@`. */
  start: number;
  /** Lower sorts first. */
  sortText: string;
  /** The closer of the innermost open block. */
  preselect?: boolean;
};

/** `@name` being typed at `offset`, or null when the cursor isn't on one. */
export function typedDirective(text: string, offset: number): { start: number; partial: string } | null {
  const m = /@([A-Za-z_]\w*)?$/.exec(text.slice(Math.max(0, offset - 64), offset));
  if (!m) return null;
  const start = offset - m[0].length;
  // Like the engine: "@" glued to a word is text (support@example.com), "@@" escapes.
  if (/[\w@.]/.test(text[start - 1] ?? '')) return null;
  return { start, partial: m[1] ?? '' };
}

/** Names of the blocks open at `offset`, innermost last. */
function openBlocks(text: string, ranges: Range[], offset: number): string[] {
  const stack: string[] = [];
  for (const r of ranges) {
    if (r.start >= offset) break;
    if (r.kind !== 'directive' || r.end > offset) continue;
    const name = r.name!;
    const args = r.innerStart !== undefined ? text.slice(r.innerStart, r.innerEnd) : undefined;
    if (opensBlock(name, args)) stack.push(name);
    else if (CLOSERS.has(name)) {
      const at = stack.map((b) => BLOCKS[b].includes(name)).lastIndexOf(true);
      if (at !== -1) stack.length = at;
    }
  }
  return stack;
}

/** Is `offset` inside a `<style>` element? `@media` there is CSS, not Megh. */
function inStyle(masked: string, offset: number) {
  const before = masked.slice(0, offset).toLowerCase();
  return before.lastIndexOf('<style') > before.lastIndexOf('</style');
}

/**
 * Later lines are not indented here: editors indent a snippet's lines to
 * match the line it's inserted on (LSP: `insertTextMode` adjustIndentation).
 */
function snippetFor(name: string, withArgs: boolean, block: boolean): string {
  const doc = DIRECTIVES[name];
  let s = `@${name}`;
  if (withArgs && doc?.args) s += `(${doc.args})`;
  if (block) {
    const closer = BLOCKS[name][0];
    s += `\n\t$0\n@${closer}`;
  }
  return s;
}

export function completeDirective(
  text: string,
  masked: string,
  offset: number,
  ranges: Range[],
): DirectiveItem[] | null {
  const typed = typedDirective(text, offset);
  if (!typed || inStyle(masked, offset)) return null;

  const open = openBlocks(text, ranges, typed.start);
  const innermost = open[open.length - 1];
  // Already followed by "(" or more of a name: insert the name alone.
  const next = text[offset] ?? '';
  const nameOnly = next === '(' || /\w/.test(next);
  // Block snippets only on a line of their own, where they're readable.
  const lineStart = text.lastIndexOf('\n', typed.start - 1) + 1;
  const ownLine = text.slice(lineStart, typed.start).trim() === '';

  const items: DirectiveItem[] = [];
  for (const [name, doc] of Object.entries(DIRECTIVES)) {
    if (!name.startsWith(typed.partial.toLowerCase()) && !name.startsWith(typed.partial)) continue;
    let rank: string;
    let preselect = false;
    if (CLOSERS.has(name)) {
      // Only the closers of blocks that are open, the innermost first.
      const depth = open.map((b) => BLOCKS[b].includes(name)).lastIndexOf(true);
      if (depth === -1) continue;
      preselect = depth === open.length - 1;
      rank = preselect ? '0' : '2';
    } else if (name === 'endjs' || name === 'endreact') {
      // @js / @react bodies are code, so these are never typed outside one.
      continue;
    } else if (name in BRANCHES) {
      if (!innermost || !BRANCHES[name].includes(innermost)) continue;
      rank = '1';
    } else {
      rank = '3';
    }
    const block = !nameOnly && ownLine && name in BLOCKS;
    const withArgs = !nameOnly && !!doc.args;
    items.push({
      label: `@${name}`,
      snippet: nameOnly ? `@${name}` : snippetFor(name, withArgs, block),
      detail: doc.syntax.split('\n')[0],
      documentation: `\`${doc.syntax.replace(/\n/g, '`\n\n`')}\`\n\n${doc.doc}`,
      start: typed.start,
      sortText: `${rank}${name}`,
      ...(preselect && { preselect }),
    });
  }
  return items;
}
