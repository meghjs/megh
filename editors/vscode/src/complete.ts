import {
  CompletionList,
  getLanguageService,
  Hover,
  ITagData,
  LanguageService,
  newHTMLDataProvider,
  Position,
} from 'vscode-html-languageservice';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { completeDirective, DirectiveItem } from './directive-complete';
import { formatTemplate, FormatOptions } from './format';
import { maskMegh, meghAt } from './mask';
import { CodeContext, CodeHover, CodeItem, completeCode, hoverCode } from './megh-code';
import { Problem, validate } from './validate';

export type Completion =
  | { type: 'html'; list: CompletionList }
  | { type: 'code'; items: CodeItem[] }
  | { type: 'directive'; items: DirectiveItem[] };

export type HoverResult =
  | { type: 'html'; hover: Hover }
  | { type: 'code'; hover: CodeHover };

/**
 * Language features for one views folder: HTML (tags, attributes, values,
 * the project's `<x-...>` components) and Megh code (variables, directives).
 */
export class MeghCompleter {
  private service: LanguageService;
  private componentNames = new Set<string>();

  constructor(components: ITagData[] = [], private ctx: Omit<CodeContext, 'view'> = {}) {
    this.service = getLanguageService();
    this.setComponents(components);
  }

  setComponents(components: ITagData[]) {
    this.componentNames = new Set(
      components.filter((t) => t.name !== 'x-slot').map((t) => t.name.slice(2)),
    );
    this.service.setDataProviders(true, [
      newHTMLDataProvider('megh-components', { version: 1.1, tags: components }),
    ]);
  }

  /** HTML items outside Megh code, Megh items inside it, `null` when neither applies. */
  complete(uri: string, text: string, position: Position, view?: string): Completion | null {
    const { masked, ranges } = maskMegh(text);
    const doc = TextDocument.create(uri, 'html', 0, masked);
    const offset = doc.offsetAt(position);
    const range = meghAt(ranges, offset);
    // On a directive's name (`@fo|` or `@fo|(items as item)`): directive names.
    const onName = range?.kind === 'directive' && offset <= range.start + 1 + range.name!.length;
    if (!range || onName) {
      const directives = completeDirective(text, masked, offset, ranges);
      if (directives) return { type: 'directive', items: directives };
    }
    if (range) {
      const items = completeCode(text, offset, range, ranges, { ...this.ctx, view });
      return items ? { type: 'code', items } : null;
    }
    const list = this.service.doComplete(doc, position, this.service.parseHTMLDocument(doc), {
      attributeDefaultValue: 'doublequotes',
    });
    return { type: 'html', list };
  }

  hover(uri: string, text: string, position: Position, view?: string): HoverResult | null {
    const { masked, ranges } = maskMegh(text);
    const doc = TextDocument.create(uri, 'html', 0, masked);
    const offset = doc.offsetAt(position);
    // The `@` of a directive is its start, so look one to the right as well.
    const range = meghAt(ranges, offset) ?? meghAt(ranges, offset + 1);
    if (range) {
      const hover = hoverCode(text, offset, range, ranges, { ...this.ctx, view });
      return hover ? { type: 'code', hover } : null;
    }
    const hover = this.service.doHover(doc, position, this.service.parseHTMLDocument(doc));
    return hover ? { type: 'html', hover } : null;
  }

  validate(text: string, options: { html?: boolean } = {}): Problem[] {
    return validate(text, { components: this.componentNames.size ? this.componentNames : undefined, ...options });
  }

  format(text: string, options: FormatOptions): string | null {
    return formatTemplate(text, options);
  }

  /** `</div>` after typing `>` or `/`, like VS Code's HTML auto-closing. */
  closeTag(uri: string, text: string, position: Position): string | null {
    const { masked, ranges } = maskMegh(text);
    const doc = TextDocument.create(uri, 'html', 0, masked);
    if (meghAt(ranges, doc.offsetAt(position))) return null;
    return this.service.doTagComplete(doc, position, this.service.parseHTMLDocument(doc)) ?? null;
  }
}
