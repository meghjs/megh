/**
 * Megh language server (LSP over stdio), for editors other than VS Code.
 *
 * It serves the same features as the VS Code extension from the same modules:
 * completion, hover, formatting and validation for `*.megh.html`, plus a
 * `megh/closeTag` request for inserting closing tags after `>` or `/`.
 *
 *   node dist/server.js --stdio
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CompletionItem,
  CompletionItemKind,
  createConnection,
  Diagnostic,
  DiagnosticSeverity,
  DidChangeWatchedFilesNotification,
  Hover,
  InitializeResult,
  InsertTextFormat,
  InsertTextMode,
  MarkupKind,
  Position,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  TextEdit,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { MeghCompleter } from './complete';
import { EXTENSION, findViewsRoot, scanComponents } from './components';
import type { FormatOptions } from './format';
import type { DirectiveItem } from './directive-complete';
import type { CodeItem } from './megh-code';
import { ProjectIndex, SourceFile } from './project';

const CODE_FILE = /\.(ts|mts|cts|js|mjs|cjs)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage', '.git']);
const MAX_CODE_FILES = 3000;

/** `megh.*` settings, the same names as the VS Code extension's. */
type Settings = {
  validate: { enable: boolean; html: boolean };
  /** HTML formatter options, like VS Code's `html.format.*`. */
  format: Partial<FormatOptions>;
};

const DEFAULTS: Settings = { validate: { enable: true, html: true }, format: {} };

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
let settings: Settings = DEFAULTS;
let workspaceDirs: string[] = [];

function mergeSettings(raw: unknown): Settings {
  const megh = (raw ?? {}) as { validate?: Partial<Settings['validate']>; format?: Partial<FormatOptions> };
  return {
    validate: { ...DEFAULTS.validate, ...megh.validate },
    format: { ...megh.format },
  };
}

connection.onInitialize((params): InitializeResult => {
  const folders = params.workspaceFolders?.map((f) => f.uri) ?? (params.rootUri ? [params.rootUri] : []);
  workspaceDirs = folders.filter((u) => u.startsWith('file:')).map((u) => fileURLToPath(u));
  settings = mergeSettings((params.initializationOptions as { megh?: unknown } | undefined)?.megh);
  watchFiles = !!params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration;
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        // The HTML triggers, plus "." for members, quotes for view names and "@" for directives.
        triggerCharacters: ['<', ' ', ':', '"', "'", '=', '/', '.', '-', '@'],
      },
      hoverProvider: true,
      documentFormattingProvider: true,
    },
    serverInfo: { name: 'megh-language-server' },
  };
});

let watchFiles = false;

connection.onInitialized(() => {
  if (!watchFiles) return;
  connection.client.register(DidChangeWatchedFilesNotification.type, {
    watchers: [{ globPattern: `**/*${EXTENSION}` }, { globPattern: '**/*.{ts,mts,cts,js,mjs,cjs}' }],
  });
});

connection.onDidChangeConfiguration((change) => {
  settings = mergeSettings((change.settings as { megh?: unknown } | undefined)?.megh);
  validateOpen();
});

// ---- project index ----

type Project = { completer: MeghCompleter; view?: string };

/** One completer and index per views root, built on first use. */
class Projects {
  private byRoot = new Map<string, { completer: MeghCompleter; index: ProjectIndex }>();
  private plain = new MeghCompleter();

  for(uri: string): Project {
    if (!uri.startsWith('file:')) return { completer: this.plain };
    const file = fileURLToPath(uri);
    const root = findViewsRoot(file);
    if (!root) return { completer: this.plain };
    let entry = this.byRoot.get(root);
    if (!entry) {
      entry = build(root);
      this.byRoot.set(root, entry);
    }
    return { completer: entry.completer, view: entry.index.viewName(file) };
  }

  clear() {
    this.byRoot.clear();
  }
}

const projects = new Projects();

function build(root: string) {
  const templates: SourceFile[] = [];
  for (const file of walk(root, (name) => name.endsWith(EXTENSION))) {
    templates.push({ path: file, text: fs.readFileSync(file, 'utf8') });
  }
  const code: SourceFile[] = [];
  let count = 0;
  for (const file of walk(codeDir(root), (name) => CODE_FILE.test(name))) {
    if (++count > MAX_CODE_FILES) break;
    try {
      const text = fs.readFileSync(file, 'utf8');
      // Only files that can hold view data or shared values.
      if (/\b(view|View|render|share)\s*\(/.test(text)) code.push({ path: file, text });
    } catch {
      // deleted meanwhile
    }
  }
  const index = new ProjectIndex(root, templates, code);
  return { completer: new MeghCompleter(scanComponents(root), { index }), index };
}

/** Where app code is read from: the workspace folder holding the views, else the nearest package. */
function codeDir(root: string): string {
  const inside = (dir: string) => {
    const rel = path.relative(dir, root);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  const folder = workspaceDirs.filter(inside).sort((a, b) => b.length - a.length)[0];
  if (folder) return folder;
  for (let dir = root; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    if (path.dirname(dir) === dir) return path.dirname(root);
  }
}

function* walk(dir: string, wanted: (name: string) => boolean): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(full, wanted);
    } else if (wanted(e.name)) yield full;
  }
}

connection.onDidChangeWatchedFiles(({ changes }) => {
  if (changes.every((c) => /[\\/](node_modules|dist|out)[\\/]/.test(c.uri))) return;
  projects.clear();
  validateOpen();
});

// A saved template is re-read too: its members and sections feed other views.
documents.onDidSave(() => {
  projects.clear();
  validateOpen();
});

// ---- completion ----

connection.onCompletion(({ textDocument, position }) => {
  const document = documents.get(textDocument.uri);
  if (!document) return null;
  const { completer, view } = projects.for(document.uri);
  const result = completer.complete(document.uri, document.getText(), position, view);
  if (!result) return null;
  if (result.type === 'html') return result.list;
  if (result.type === 'directive') {
    return result.items.map((item) => toDirectiveCompletion(item, document, position));
  }
  return result.items.map((item) => toCompletionItem(item, document, position));
});

function toDirectiveCompletion(item: DirectiveItem, document: TextDocument, position: Position): CompletionItem {
  return {
    label: item.label,
    kind: CompletionItemKind.Keyword,
    detail: item.detail,
    documentation: { kind: MarkupKind.Markdown, value: item.documentation },
    sortText: item.sortText,
    preselect: item.preselect,
    // The label starts with "@", so clients filter on what was typed after it too.
    filterText: item.label,
    insertTextFormat: InsertTextFormat.Snippet,
    insertTextMode: InsertTextMode.adjustIndentation,
    textEdit: TextEdit.replace({ start: document.positionAt(item.start), end: position }, item.snippet),
  };
}

function toCompletionItem(item: CodeItem, document: TextDocument, position: Position): CompletionItem {
  const kinds = {
    variable: CompletionItemKind.Variable,
    property: CompletionItemKind.Property,
    view: CompletionItemKind.File,
    section: CompletionItemKind.Reference,
  };
  return {
    label: item.label,
    kind: kinds[item.kind],
    detail: item.detail,
    documentation: item.documentation ? { kind: MarkupKind.Markdown, value: item.documentation } : undefined,
    textEdit: TextEdit.replace({ start: document.positionAt(item.start), end: position }, item.label),
  };
}

// ---- hover ----

connection.onHover(({ textDocument, position }): Hover | null => {
  const document = documents.get(textDocument.uri);
  if (!document) return null;
  const { completer, view } = projects.for(document.uri);
  const result = completer.hover(document.uri, document.getText(), position, view);
  if (!result) return null;
  if (result.type === 'html') return result.hover;
  const { markdown, start, end } = result.hover;
  return {
    contents: { kind: MarkupKind.Markdown, value: markdown },
    range: { start: document.positionAt(start), end: document.positionAt(end) },
  };
});

// ---- formatting ----

connection.onDocumentFormatting(({ textDocument, options }) => {
  const document = documents.get(textDocument.uri);
  if (!document) return [];
  const { completer } = projects.for(document.uri);
  const text = document.getText();
  // The HTML formatter's defaults in VS Code, then the user's `megh.format`.
  const formatted = completer.format(text, {
    wrapLineLength: 120,
    indentInnerHtml: false,
    preserveNewLines: true,
    endWithNewline: false,
    wrapAttributes: 'auto',
    ...settings.format,
    tabSize: options.tabSize,
    insertSpaces: options.insertSpaces,
  });
  if (formatted === null || formatted === text) return [];
  return [TextEdit.replace({ start: { line: 0, character: 0 }, end: document.positionAt(text.length) }, formatted)];
});

// ---- closing tags ----

/** `$0</div>` (a snippet) after typing `>` or `/` at `position`, or null. */
connection.onRequest('megh/closeTag', (params: { textDocument: { uri: string }; position: Position }) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  const { completer } = projects.for(document.uri);
  return completer.closeTag(document.uri, document.getText(), params.position);
});

// ---- validation ----

const timers = new Map<string, NodeJS.Timeout>();

function validateSoon(document: TextDocument, delay = 300) {
  clearTimeout(timers.get(document.uri));
  timers.set(
    document.uri,
    setTimeout(() => {
      timers.delete(document.uri);
      const current = documents.get(document.uri);
      if (!current) return;
      if (!settings.validate.enable) {
        connection.sendDiagnostics({ uri: current.uri, diagnostics: [] });
        return;
      }
      const { completer } = projects.for(current.uri);
      const problems = completer.validate(current.getText(), { html: settings.validate.html });
      const diagnostics: Diagnostic[] = problems.map((p) => ({
        range: { start: current.positionAt(p.start), end: current.positionAt(p.end) },
        message: p.message,
        severity: p.severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
        source: 'megh',
      }));
      connection.sendDiagnostics({ uri: current.uri, version: current.version, diagnostics });
    }, delay),
  );
}

function validateOpen() {
  for (const d of documents.all()) validateSoon(d, 0);
}

documents.onDidChangeContent((e) => validateSoon(e.document));
documents.onDidClose((e) => {
  clearTimeout(timers.get(e.document.uri));
  timers.delete(e.document.uri);
  connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});

documents.listen(connection);
connection.listen();
