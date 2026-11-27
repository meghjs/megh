import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type * as lsp from 'vscode-html-languageservice';
import { MeghCompleter } from './complete';
import { EXTENSION, findViewsRoot, scanComponents } from './components';
import type { FormatOptions } from './format';
import type { DirectiveItem } from './directive-complete';
import type { CodeItem } from './megh-code';
import { ProjectIndex, SourceFile } from './project';

const LANGUAGE = 'megh';
const CODE_GLOB = '**/*.{ts,mts,cts,js,mjs,cjs}';
const CODE_EXCLUDE = '**/{node_modules,dist,out,build,coverage,.git}/**';

export function activate(context: vscode.ExtensionContext) {
  const projects = new Projects();
  const diagnostics = vscode.languages.createDiagnosticCollection('megh');
  context.subscriptions.push(diagnostics);

  // ---- completion ----
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      LANGUAGE,
      {
        async provideCompletionItems(document, position) {
          const { completer, view } = await projects.for(document);
          const result = completer.complete(document.uri.toString(), document.getText(), position, view);
          if (!result) return undefined;
          if (result.type === 'html') return toVscodeList(result.list);
          if (result.type === 'directive') {
            return result.items.map((item) => toDirectiveItem(item, document, position));
          }
          return result.items.map((item) => toCodeItem(item, document, position));
        },
      },
      // The HTML extension's triggers, plus "." for members, quotes for view names
      // and "@" for directives.
      '<', ' ', ':', '"', "'", '=', '/', '.', '-', '@',
    ),
  );

  // ---- hover ----
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(LANGUAGE, {
      async provideHover(document, position) {
        const { completer, view } = await projects.for(document);
        const result = completer.hover(document.uri.toString(), document.getText(), position, view);
        if (!result) return undefined;
        if (result.type === 'code') {
          const { markdown, start, end } = result.hover;
          return new vscode.Hover(
            new vscode.MarkdownString(markdown),
            new vscode.Range(document.positionAt(start), document.positionAt(end)),
          );
        }
        const { contents, range } = result.hover;
        const parts = (Array.isArray(contents) ? contents : [contents]).map((c) =>
          typeof c === 'string' ? new vscode.MarkdownString(c) : new vscode.MarkdownString(c.value),
        );
        return new vscode.Hover(parts, range && toRange(range));
      },
    }),
  );

  // ---- formatting ----
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(LANGUAGE, {
      async provideDocumentFormattingEdits(document, options) {
        const { completer } = await projects.for(document);
        const text = document.getText();
        const formatted = completer.format(text, formatOptions(document, options));
        if (formatted === null || formatted === text) return [];
        const all = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
        return [vscode.TextEdit.replace(all, formatted)];
      },
    }),
  );

  // ---- validation ----
  const timers = new Map<string, NodeJS.Timeout>();
  const validateSoon = (document: vscode.TextDocument, delay = 300) => {
    if (document.languageId !== LANGUAGE) return;
    const key = document.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(async () => {
        timers.delete(key);
        const config = vscode.workspace.getConfiguration('megh', document.uri);
        if (!config.get('validate.enable', true)) return diagnostics.delete(document.uri);
        const { completer } = await projects.for(document);
        const problems = completer.validate(document.getText(), { html: config.get('validate.html', true) });
        diagnostics.set(
          document.uri,
          problems.map((p) => {
            const d = new vscode.Diagnostic(
              new vscode.Range(document.positionAt(p.start), document.positionAt(p.end)),
              p.message,
              p.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
            );
            d.source = 'megh';
            return d;
          }),
        );
      }, delay),
    );
  };
  const validateOpen = () => vscode.workspace.textDocuments.forEach((d) => validateSoon(d, 0));
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((d) => validateSoon(d, 0)),
    vscode.workspace.onDidChangeTextDocument((e) => validateSoon(e.document)),
    vscode.workspace.onDidCloseTextDocument((d) => diagnostics.delete(d.uri)),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('megh') && validateOpen()),
  );
  validateOpen();

  // ---- keep the index fresh ----
  const templates = vscode.workspace.createFileSystemWatcher(`**/*${EXTENSION}`);
  const code = vscode.workspace.createFileSystemWatcher(CODE_GLOB);
  for (const w of [templates, code]) {
    const changed = (uri: vscode.Uri) => {
      if (/[\\/](node_modules|dist|out)[\\/]/.test(uri.fsPath)) return;
      projects.clear();
      validateOpen();
    };
    // A saved template is re-read too: its members and sections feed other views.
    w.onDidCreate(changed);
    w.onDidChange(changed);
    w.onDidDelete(changed);
    context.subscriptions.push(w);
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => autoCloseTag(e, projects)),
  );
}

export function deactivate() {}

type Project = { completer: MeghCompleter; view?: string };

/** One completer and index per views root, built on first use. */
class Projects {
  private byRoot = new Map<string, Promise<{ completer: MeghCompleter; index: ProjectIndex }>>();
  private plain = new MeghCompleter();

  async for(document: vscode.TextDocument): Promise<Project> {
    if (document.uri.scheme !== 'file') return { completer: this.plain };
    const root = findViewsRoot(document.uri.fsPath);
    if (!root) return { completer: this.plain };
    let entry = this.byRoot.get(root);
    if (!entry) {
      entry = this.build(root, document.uri);
      this.byRoot.set(root, entry);
    }
    const { completer, index } = await entry;
    return { completer, view: index.viewName(document.uri.fsPath) };
  }

  clear() {
    this.byRoot.clear();
  }

  private async build(root: string, uri: vscode.Uri) {
    const templates: SourceFile[] = [];
    for (const file of walk(root)) templates.push({ path: file, text: fs.readFileSync(file, 'utf8') });

    const code: SourceFile[] = [];
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder) {
      const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, CODE_GLOB), CODE_EXCLUDE, 3000);
      for (const f of files) {
        try {
          const text = fs.readFileSync(f.fsPath, 'utf8');
          // Only files that can hold view data or shared values.
          if (/\b(view|View|render|share)\s*\(/.test(text)) code.push({ path: f.fsPath, text });
        } catch {
          // deleted meanwhile
        }
      }
    }
    const index = new ProjectIndex(root, templates, code);
    return { completer: new MeghCompleter(scanComponents(root), { index }), index };
  }
}

function* walk(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') yield* walk(full);
    } else if (e.name.endsWith(EXTENSION)) yield full;
  }
}

function formatOptions(document: vscode.TextDocument, options: vscode.FormattingOptions): FormatOptions {
  // Reuse the user's HTML formatter settings.
  const html = vscode.workspace.getConfiguration('html.format', document.uri);
  const list = (key: string) => {
    const v = html.get<string | null>(key);
    return v === null || v === undefined ? undefined : v;
  };
  return {
    tabSize: options.tabSize,
    insertSpaces: options.insertSpaces,
    wrapLineLength: html.get('wrapLineLength', 120),
    unformatted: list('unformatted'),
    contentUnformatted: list('contentUnformatted'),
    indentInnerHtml: html.get('indentInnerHtml', false),
    preserveNewLines: html.get('preserveNewLines', true),
    maxPreserveNewLines: html.get<number | undefined>('maxPreserveNewLines') ?? undefined,
    endWithNewline: html.get('endWithNewline', false),
    extraLiners: list('extraLiners'),
    wrapAttributes: html.get('wrapAttributes', 'auto'),
  };
}

// ---------- auto-closing tags ----------

function autoCloseTag(e: vscode.TextDocumentChangeEvent, projects: Projects) {
  const editor = vscode.window.activeTextEditor;
  if (
    !editor ||
    editor.document !== e.document ||
    e.document.languageId !== LANGUAGE ||
    e.contentChanges.length !== 1 ||
    !vscode.workspace.getConfiguration('megh').get('autoClosingTags', true)
  ) {
    return;
  }
  const change = e.contentChanges[0];
  if (change.text !== '>' && change.text !== '/') return;
  const position = change.range.start.translate(0, 1);
  const text = e.document.getText();
  // Wait a tick so the typed character's undo stop is separate.
  setTimeout(async () => {
    if (editor.document.getText() !== text) return;
    const { completer } = await projects.for(e.document);
    if (editor.document.getText() !== text) return;
    const snippet = completer.closeTag(e.document.uri.toString(), text, position);
    if (snippet) editor.insertSnippet(new vscode.SnippetString(snippet), position);
  }, 0);
}

// ---------- conversions ----------

function toCodeItem(item: CodeItem, document: vscode.TextDocument, position: vscode.Position) {
  const kinds = {
    variable: vscode.CompletionItemKind.Variable,
    property: vscode.CompletionItemKind.Property,
    view: vscode.CompletionItemKind.File,
    section: vscode.CompletionItemKind.Reference,
  };
  const out = new vscode.CompletionItem(item.label, kinds[item.kind]);
  out.detail = item.detail;
  if (item.documentation) out.documentation = new vscode.MarkdownString(item.documentation);
  out.range = new vscode.Range(document.positionAt(item.start), position);
  return out;
}

function toDirectiveItem(item: DirectiveItem, document: vscode.TextDocument, position: vscode.Position) {
  const out = new vscode.CompletionItem(item.label, vscode.CompletionItemKind.Keyword);
  out.detail = item.detail;
  out.documentation = new vscode.MarkdownString(item.documentation);
  out.insertText = new vscode.SnippetString(item.snippet);
  out.range = new vscode.Range(document.positionAt(item.start), position);
  out.sortText = item.sortText;
  out.preselect = item.preselect;
  return out;
}

function toVscodeList(list: lsp.CompletionList): vscode.CompletionList {
  return new vscode.CompletionList(list.items.map(toVscodeItem), list.isIncomplete);
}

function toVscodeItem(item: lsp.CompletionItem): vscode.CompletionItem {
  const out = new vscode.CompletionItem(item.label);
  // LSP kinds start at 1, vscode's at 0.
  if (item.kind) out.kind = (item.kind - 1) as vscode.CompletionItemKind;
  out.detail = item.detail;
  out.sortText = item.sortText;
  out.filterText = item.filterText;
  if (item.documentation) {
    out.documentation =
      typeof item.documentation === 'string'
        ? item.documentation
        : new vscode.MarkdownString(item.documentation.value);
  }
  const snippet = item.insertTextFormat === 2;
  const edit = item.textEdit;
  if (edit) {
    out.insertText = snippet ? new vscode.SnippetString(edit.newText) : edit.newText;
    out.range = 'range' in edit
      ? toRange(edit.range)
      : { inserting: toRange(edit.insert), replacing: toRange(edit.replace) };
  } else if (item.insertText) {
    out.insertText = snippet ? new vscode.SnippetString(item.insertText) : item.insertText;
  }
  if (item.command) {
    out.command = { title: item.command.title, command: item.command.command, arguments: item.command.arguments };
  }
  return out;
}

function toRange(r: lsp.Range) {
  return new vscode.Range(r.start.line, r.start.character, r.end.line, r.end.character);
}
