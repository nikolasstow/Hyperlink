/**
 * A fake `vscode` module, enough for an extension to activate and register its
 * providers, with every registration captured so a server can call them.
 *
 * The surface is VS Code's own (classes, events, promises), because that is what
 * extension code calls; that shape is not ours to change. Everything underneath
 * it (file reads, directory walks) runs as Effects on the runtime the host hands
 * in, and promises exist only at the edge VS Code's API defines.
 *
 * Anything an extension touches that is not implemented is recorded in
 * `missing` and answered with an inert stub, so a run reports its gaps instead
 * of dying on the first one.
 */
import { Effect, FileSystem, Path, Predicate } from "effect";

export interface ShimRuntime {
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) => Promise<A>;
}

export interface Registry {
  readonly commands: Map<string, (...args: ReadonlyArray<unknown>) => unknown>;
  readonly treeViews: Map<string, unknown>;
  readonly taskProviders: Map<string, unknown>;
  readonly providers: Array<{
    readonly kind: string;
    readonly selector: unknown;
    readonly provider: unknown;
  }>;
  readonly contextKeys: Map<string, unknown>;
  readonly executedTasks: Array<unknown>;
  /** Files the extension asked to show, in order. */
  readonly opened: Array<{
    readonly path: string;
    readonly line: number | undefined;
  }>;
  readonly messages: Array<{
    readonly level: string;
    readonly text: unknown;
  }>;
  readonly missing: Set<string>;
}

export const makeRegistry = (): Registry => ({
  commands: new Map(),
  treeViews: new Map(),
  taskProviders: new Map(),
  providers: [],
  contextKeys: new Map(),
  executedTasks: [],
  opened: [],
  messages: [],
  missing: new Set(),
});

/** An inert stand-in for an unimplemented member: callable, constructible, and
 * every property is another stub, each access recorded by name. */
const stub = (registry: Registry, name: string): unknown =>
  new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === "then" || typeof prop === "symbol") return undefined;
      const full = `${name}.${prop}`;
      registry.missing.add(full);
      return stub(registry, full);
    },
    apply() {
      registry.missing.add(`${name}()`);
      return stub(registry, `${name}()`);
    },
    construct() {
      registry.missing.add(`new ${name}`);
      return {};
    },
    set() {
      return true;
    },
  });

/** Wrap a namespace so a missing member is recorded and stubbed. `then` is never
 * stubbed: a stubbed `then` makes `await` treat the object as a promise that
 * never settles. */
const recorded = <T extends object>(registry: Registry, name: string, target: T): T =>
  new Proxy(target, {
    get(t, prop, receiver) {
      if (prop in t || typeof prop === "symbol") return Reflect.get(t, prop, receiver);
      if (prop === "then" || prop === "__esModule") return undefined;
      const full = `${name}.${prop}`;
      registry.missing.add(full);
      return stub(registry, full);
    },
  });

export class Disposable {
  constructor(private readonly onDispose?: () => void) {}
  static from(...items: ReadonlyArray<{ readonly dispose?: () => void }>): Disposable {
    return new Disposable(() => items.forEach((item) => item.dispose?.()));
  }
  dispose(): void {
    this.onDispose?.();
  }
}

export class EventEmitter<T> {
  private listeners: Array<(value: T) => void> = [];
  readonly event = (listener: (value: T) => void): Disposable => {
    this.listeners.push(listener);
    return new Disposable(() => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    });
  };
  fire(value: T): void {
    this.listeners.forEach((l) => l(value));
  }
  dispose(): void {
    this.listeners = [];
  }
}

const noEvent = (): Disposable => new Disposable();

export class Uri {
  readonly path: string;
  constructor(
    readonly scheme: string,
    readonly fsPath: string,
  ) {
    this.path = fsPath;
  }
  static file(p: string): Uri {
    return new Uri("file", p);
  }
  static parse(s: string): Uri {
    return s.startsWith("file://") ? Uri.file(decodeURIComponent(s.slice(7))) : new Uri(s.split(":")[0] ?? "", s);
  }
  static joinPath(base: Uri, ...parts: ReadonlyArray<string>): Uri {
    return Uri.file([base.fsPath, ...parts].join("/").replace(/\/+/g, "/"));
  }
  with(change: { readonly path?: string }): Uri {
    return Uri.file(change.path ?? this.fsPath);
  }
  toString(): string {
    return `file://${this.fsPath}`;
  }
  toJSON(): string {
    return this.toString();
  }
}

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
};

export class TreeItem {
  label?: unknown;
  resourceUri?: Uri;
  constructor(
    labelOrUri: unknown,
    public collapsibleState: number = 0,
  ) {
    if (labelOrUri instanceof Uri) this.resourceUri = labelOrUri;
    else this.label = labelOrUri;
  }
}

export class ThemeIcon {
  static readonly File = new ThemeIcon("file");
  static readonly Folder = new ThemeIcon("folder");
  constructor(
    readonly id: string,
    readonly color?: unknown,
  ) {}
}

export class Position {
  constructor(
    readonly line: number,
    readonly character: number,
  ) {}
}

export class Range {
  readonly start: Position;
  readonly end: Position;
  constructor(a: Position | number, b: Position | number, c = 0, d = 0) {
    this.start = a instanceof Position ? a : new Position(a, typeof b === "number" ? b : 0);
    this.end = b instanceof Position ? b : new Position(c, d);
  }
}

export class Location {
  constructor(
    readonly uri: Uri,
    readonly range: Range,
  ) {}
}

export class MarkdownString {
  constructor(public value = "") {}
  appendMarkdown(v: string): this {
    this.value += v;
    return this;
  }
  appendText(v: string): this {
    this.value += v;
    return this;
  }
}

class TaskGroupId {
  constructor(readonly id: string) {}
}

export const TaskGroup = {
  Build: new TaskGroupId("build"),
  Test: new TaskGroupId("test"),
  Clean: new TaskGroupId("clean"),
  Rebuild: new TaskGroupId("rebuild"),
};

export class ShellExecution {
  readonly commandLine?: string;
  readonly command?: unknown;
  readonly args?: ReadonlyArray<unknown>;
  readonly options?: unknown;
  constructor(commandOrLine: unknown, argsOrOptions?: unknown, options?: unknown) {
    if (Array.isArray(argsOrOptions)) {
      this.command = commandOrLine;
      this.args = argsOrOptions;
      this.options = options;
    } else {
      this.commandLine = typeof commandOrLine === "string" ? commandOrLine : undefined;
      this.options = argsOrOptions;
    }
  }
}

export class ProcessExecution {
  constructor(
    readonly process: string,
    readonly args?: ReadonlyArray<string>,
    readonly options?: unknown,
  ) {}
}

export class Task {
  group?: TaskGroupId;
  constructor(
    readonly definition: unknown,
    readonly scope: unknown,
    readonly name: string,
    readonly source: string,
    readonly execution?: ShellExecution | ProcessExecution,
    readonly problemMatchers?: ReadonlyArray<string>,
  ) {}
}

export class CompletionItem {
  constructor(
    readonly label: unknown,
    readonly kind?: unknown,
  ) {}
}

export class CodeLens {
  constructor(
    readonly range: Range,
    readonly command?: unknown,
  ) {}
}

export class Hover {
  constructor(
    readonly contents: unknown,
    readonly range?: Range,
  ) {}
}

export class RelativePattern {
  readonly base: string;
  constructor(
    base: Uri | { readonly uri: Uri } | string,
    readonly pattern: string,
  ) {
    this.base = typeof base === "string" ? base : base instanceof Uri ? base.fsPath : base.uri.fsPath;
  }
}

export class CodeActionKind {
  static readonly Empty = new CodeActionKind("");
  static readonly QuickFix = new CodeActionKind("quickfix");
  static readonly Refactor = new CodeActionKind("refactor");
  static readonly Source = new CodeActionKind("source");
  static readonly SourceOrganizeImports = new CodeActionKind("source.organizeImports");
  static readonly SourceFixAll = new CodeActionKind("source.fixAll");
  constructor(readonly value: string) {}
  append(part: string): CodeActionKind {
    return new CodeActionKind(this.value === "" ? part : `${this.value}.${part}`);
  }
  contains(other: CodeActionKind): boolean {
    return this.value === other.value || other.value.startsWith(`${this.value}.`);
  }
  intersects(other: CodeActionKind): boolean {
    return this.contains(other) || other.contains(this);
  }
}

export class CodeAction {
  edit?: WorkspaceEdit;
  command?: unknown;
  constructor(
    readonly title: string,
    readonly kind?: CodeActionKind,
  ) {}
}

export class TextEdit {
  constructor(
    readonly range: Range,
    readonly newText: string,
  ) {}
  static replace(range: Range, newText: string): TextEdit {
    return new TextEdit(range, newText);
  }
  static insert(position: Position, newText: string): TextEdit {
    return new TextEdit(new Range(position, position), newText);
  }
  static delete(range: Range): TextEdit {
    return new TextEdit(range, "");
  }
}

export class WorkspaceEdit {
  readonly edits: Array<{
    readonly uri: Uri;
    readonly edit: TextEdit;
  }> = [];
  replace(uri: Uri, range: Range, newText: string): void {
    this.edits.push({
      uri,
      edit: TextEdit.replace(range, newText),
    });
  }
  insert(uri: Uri, position: Position, newText: string): void {
    this.edits.push({
      uri,
      edit: TextEdit.insert(position, newText),
    });
  }
  set(uri: Uri, edits: ReadonlyArray<TextEdit>): void {
    edits.forEach((edit) =>
      this.edits.push({
        uri,
        edit,
      }),
    );
  }
}

export class ThemeColor {
  constructor(readonly id: string) {}
}

/** A status bar or language status item: fields the extension writes, with
 * show / hide / dispose doing nothing, since there is no status bar here. */
const statusItem = () => ({
  text: "",
  tooltip: undefined,
  command: undefined,
  severity: 0,
  busy: false,
  name: "",
  detail: "",
  show: () => undefined,
  hide: () => undefined,
  dispose: () => undefined,
});

export class TerminalQuickFixCommand {
  constructor(readonly terminalCommand: string) {}
}

/** Skipped during file searches, as VS Code's default `files.exclude` would. */
const skippedDirs = new Set(["node_modules", ".git", "repos", "archive", "dist"]);

/** `workspace.findFiles` for the `**\/name` patterns extensions use to locate
 * config files, walked with the FileSystem service. An unreadable directory is
 * skipped, as VS Code's own search skips what it cannot list. */
const findFiles = (root: string, pattern: string, max: number | undefined) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const name = pattern.split("/").at(-1) ?? pattern;
    const walk = (dir: string, depth: number): Effect.Effect<ReadonlyArray<Uri>> =>
      depth > 6
        ? Effect.succeed([])
        : fs.readDirectory(dir).pipe(
            Effect.catch(() => Effect.succeed<ReadonlyArray<string>>([])),
            Effect.flatMap((entries) =>
              Effect.forEach(entries.filter((entry) => !skippedDirs.has(entry)), (entry) => {
                const full = path.join(dir, entry);
                if (entry === name) return Effect.succeed<ReadonlyArray<Uri>>([Uri.file(full)]);
                return fs.stat(full).pipe(
                  Effect.flatMap((info) =>
                    info.type === "Directory" ? walk(full, depth + 1) : Effect.succeed<ReadonlyArray<Uri>>([]),
                  ),
                  Effect.catch(() => Effect.succeed<ReadonlyArray<Uri>>([])),
                );
              }),
            ),
            Effect.map((nested) => nested.flat()),
          );
    const found = yield* walk(root, 0);
    return max === undefined ? found : found.slice(0, max);
  });

/** VS Code language ids by extension, for the files a formatter is handed. */
const languageIds: Record<string, string> = {
  ts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  jsx: "javascriptreact",
  mjs: "javascript",
  json: "json",
  md: "markdown",
  css: "css",
  html: "html",
  yaml: "yaml",
  yml: "yaml",
};

const languageOf = (file: string): string => languageIds[file.split(".").at(-1) ?? ""] ?? "plaintext";

/** A file-open request (`vscode.open`, `showTextDocument`) as a path and the
 * 1-based line its selection starts on, if it gave one. */
const recordOpen = (registry: Registry, target: unknown, options: unknown): void => {
  const path =
    target instanceof Uri
      ? target.fsPath
      : Predicate.hasProperty(target, "uri") && target.uri instanceof Uri
        ? target.uri.fsPath
        : undefined;
  if (path === undefined) return;
  const selection = Predicate.hasProperty(options, "selection") ? options.selection : undefined;
  const line = selection instanceof Range ? selection.start.line + 1 : undefined;
  registry.opened.push({
    path,
    line,
  });
};

/** A folder the host serves, as the extension sees it. `name` is unique among
 * the folders: extensions (npm among them) key their trees by it. */
export interface WorkspaceFolderInfo {
  readonly path: string;
  readonly name: string;
}

export interface ShimOptions {
  /** The folders the host serves right now; it grows as workspaces arrive. */
  readonly folders: () => ReadonlyArray<WorkspaceFolderInfo>;
  /** Fired when folders are added, as VS Code fires it for a multi-root window. */
  readonly foldersChanged: EventEmitter<{
    readonly added: ReadonlyArray<unknown>;
    readonly removed: ReadonlyArray<unknown>;
  }>;
  readonly defaults: ReadonlyMap<string, unknown>;
  readonly runtime: ShimRuntime;
  readonly registry: Registry;
}

/** VS Code's `WorkspaceFolder` for one folder at `index`. */
export const toWorkspaceFolder = (info: WorkspaceFolderInfo, index: number) => ({
  uri: Uri.file(info.path),
  name: info.name,
  index,
});

/** Build the `vscode` module object an extension receives. */
export const makeVscode = (options: ShimOptions) => {
  const { registry, runtime, defaults, folders, foldersChanged } = options;
  const workspaceFolders = () => folders().map(toWorkspaceFolder);
  /** The folder holding `target` (the deepest one, if folders nest), as VS
   * Code resolves it; undefined for a path outside every folder. */
  const folderOf = (target: unknown) => {
    const path = target instanceof Uri ? target.fsPath : Predicate.hasProperty(target, "uri") && target.uri instanceof Uri ? target.uri.fsPath : undefined;
    if (path === undefined) return undefined;
    return workspaceFolders()
      .filter((folder) => path === folder.uri.fsPath || path.startsWith(`${folder.uri.fsPath}/`))
      .sort((a, b) => b.uri.fsPath.length - a.uri.fsPath.length)
      .at(0);
  };

  const configuration = (section?: string) => {
    const fullKey = (key: string) => (section === undefined ? key : `${section}.${key}`);
    const methods = {
      get: (key: string, fallback?: unknown) => (defaults.has(fullKey(key)) ? defaults.get(fullKey(key)) : fallback),
      has: (key: string) => defaults.has(fullKey(key)),
      inspect: () => undefined,
      update: () => Promise.resolve(),
    };
    // VS Code also exposes each setting as a property (`config.enable`), which
    // is how some extensions read them.
    return new Proxy(methods, {
      get(target, prop, receiver) {
        if (typeof prop === "symbol" || prop in target) return Reflect.get(target, prop, receiver);
        if (prop === "then") return undefined;
        if (defaults.has(fullKey(prop))) return defaults.get(fullKey(prop));
        registry.missing.add(`setting:${fullKey(prop)}`);
        return undefined;
      },
    });
  };

  const openTextDocument = (target: Uri | string) => {
    const file = target instanceof Uri ? target.fsPath : target;
    return runtime.runPromise(
      FileSystem.FileSystem.pipe(
        Effect.flatMap((fs) => fs.readFileString(file)),
        Effect.map((text) => {
          const lines = text.split("\n");
          return recorded(registry, "TextDocument", {
            uri: Uri.file(file),
            fileName: file,
            languageId: languageOf(file),
            version: 1,
            isDirty: false,
            isUntitled: false,
            eol: 1,
            lineCount: lines.length,
            lineAt: (line: number) => ({
              lineNumber: line,
              text: lines[line] ?? "",
              range: new Range(line, 0, line, (lines[line] ?? "").length),
            }),
            getText: (range?: Range) =>
              range === undefined
                ? text
                : text.slice(
                    lines.slice(0, range.start.line).reduce((n, l) => n + l.length + 1, 0) + range.start.character,
                    lines.slice(0, range.end.line).reduce((n, l) => n + l.length + 1, 0) + range.end.character,
                  ),
            positionAt: (offset: number) => {
              const before = text.slice(0, offset).split("\n");
              return new Position(before.length - 1, (before.at(-1) ?? "").length);
            },
            offsetAt: (position: Position) =>
              lines.slice(0, position.line).reduce((n, line) => n + line.length + 1, 0) + position.character,
          });
        }),
      ),
    );
  };

  const register =
    (kind: string) =>
    (selector: unknown, provider: unknown): Disposable => {
      registry.providers.push({
        kind,
        selector,
        provider,
      });
      return new Disposable();
    };

  return recorded(registry, "vscode", {
    version: "1.100.0",
    Disposable,
    EventEmitter,
    Uri,
    TreeItem,
    TreeItemCollapsibleState,
    ThemeIcon,
    Position,
    Range,
    Selection: Range,
    Location,
    MarkdownString,
    TaskGroup,
    ShellExecution,
    ProcessExecution,
    Task,
    TaskScope: {
      Global: 1,
      Workspace: 2,
    },
    TaskRevealKind: {
      Always: 1,
      Silent: 2,
      Never: 3,
    },
    TaskPanelKind: {
      Shared: 1,
      Dedicated: 2,
      New: 3,
    },
    CompletionItem,
    CompletionItemKind: new Proxy({}, { get: (_t, prop) => String(prop) }),
    CodeLens,
    Hover,
    RelativePattern,
    TerminalQuickFixCommand,
    CodeActionKind,
    CodeAction,
    TextEdit,
    WorkspaceEdit,
    ThemeColor,
    StatusBarAlignment: {
      Left: 1,
      Right: 2,
    },
    LanguageStatusSeverity: {
      Information: 0,
      Warning: 1,
      Error: 2,
    },
    ConfigurationTarget: {
      Global: 1,
      Workspace: 2,
      WorkspaceFolder: 3,
    },
    l10n: {
      t: (message: string | { readonly message: string }, ...args: ReadonlyArray<unknown>) => {
        const text = typeof message === "string" ? message : message.message;
        const first = args[0];
        const values: Record<string, unknown> =
          args.length === 1 && typeof first === "object" && first !== null ? { ...first } : { ...args };
        return text.replace(/\{(\w+)\}/g, (match: string, key: string) =>
          values[key] === undefined ? match : String(values[key]),
        );
      },
    },
    env: recorded(registry, "env", {
      appName: "DoubleAgent",
      language: "en",
      openExternal: () => Promise.resolve(true),
    }),
    commands: recorded(registry, "commands", {
      // `thisArg` matters: extensions register methods (`this.runScript, this`).
      registerCommand: (id: string, fn: (...args: ReadonlyArray<unknown>) => unknown, thisArg?: unknown) => {
        registry.commands.set(id, (...args) => fn.apply(thisArg, [...args]));
        return new Disposable(() => registry.commands.delete(id));
      },
      executeCommand: (id: string, ...args: ReadonlyArray<unknown>) => {
        if (id === "vscode.open") {
          recordOpen(registry, args[0], args[1]);
          return Promise.resolve(undefined);
        }
        if (id === "setContext") {
          registry.contextKeys.set(String(args[0]), args[1]);
          return Promise.resolve(undefined);
        }
        const fn = registry.commands.get(id);
        if (fn !== undefined) return Promise.resolve(fn(...args));
        registry.missing.add(`command:${id}`);
        return Promise.resolve(undefined);
      },
    }),
    window: recorded(registry, "window", {
      activeTextEditor: undefined,
      visibleTextEditors: [],
      onDidChangeActiveTextEditor: noEvent,
      createTreeView: (id: string, viewOptions: { readonly treeDataProvider: unknown }) => {
        registry.treeViews.set(id, viewOptions.treeDataProvider);
        return recorded(registry, "TreeView", {
          visible: true,
          onDidChangeVisibility: noEvent,
          onDidChangeSelection: noEvent,
          onDidExpandElement: noEvent,
          onDidCollapseElement: noEvent,
          reveal: () => Promise.resolve(undefined),
          dispose: () => undefined,
        });
      },
      registerTreeDataProvider: (id: string, provider: unknown) => {
        registry.treeViews.set(id, provider);
        return new Disposable();
      },
      registerTerminalQuickFixProvider: register("terminalQuickFix"),
      showInformationMessage: (text: unknown) => {
        registry.messages.push({
          level: "info",
          text,
        });
        return Promise.resolve(undefined);
      },
      showWarningMessage: (text: unknown) => {
        registry.messages.push({
          level: "warn",
          text,
        });
        return Promise.resolve(undefined);
      },
      showErrorMessage: (text: unknown) => {
        registry.messages.push({
          level: "error",
          text,
        });
        return Promise.resolve(undefined);
      },
      createStatusBarItem: statusItem,
      showTextDocument: (target: unknown, options?: unknown) => {
        recordOpen(registry, target, options);
        return Promise.resolve(undefined);
      },
      createOutputChannel: () =>
        recorded(registry, "OutputChannel", {
          appendLine: () => undefined,
          append: () => undefined,
          show: () => undefined,
          dispose: () => undefined,
        }),
    }),
    workspace: recorded(registry, "workspace", {
      get workspaceFolders() {
        return workspaceFolders();
      },
      getWorkspaceFolder: folderOf,
      isTrusted: true,
      getConfiguration: configuration,
      onDidChangeConfiguration: noEvent,
      onDidChangeWorkspaceFolders: foldersChanged.event,
      onDidChangeTextDocument: noEvent,
      onDidSaveTextDocument: noEvent,
      createFileSystemWatcher: () =>
        recorded(registry, "FileSystemWatcher", {
          onDidChange: noEvent,
          onDidCreate: noEvent,
          onDidDelete: noEvent,
          dispose: () => undefined,
        }),
      // A bare pattern searches every folder, as VS Code does; a relative one
      // searches its base.
      findFiles: (include: string | RelativePattern, _exclude?: unknown, max?: number) =>
        runtime.runPromise(
          typeof include === "string"
            ? Effect.forEach(folders(), (folder) => findFiles(folder.path, include, max)).pipe(
                Effect.map((found) => {
                  const all = found.flat();
                  return max === undefined ? all : all.slice(0, max);
                }),
              )
            : findFiles(include.base, include.pattern, max),
        ),
      fs: recorded(registry, "workspace.fs", {
        readFile: (uri: Uri) =>
          runtime.runPromise(FileSystem.FileSystem.pipe(Effect.flatMap((fs) => fs.readFile(uri.fsPath)))),
        stat: (uri: Uri) =>
          runtime.runPromise(
            FileSystem.FileSystem.pipe(
              Effect.flatMap((fs) => fs.stat(uri.fsPath)),
              Effect.map((info) => ({
                type: info.type === "Directory" ? 2 : 1,
                size: Number(info.size),
              })),
            ),
          ),
      }),
      openTextDocument,
    }),
    tasks: recorded(registry, "tasks", {
      registerTaskProvider: (type: string, provider: unknown) => {
        registry.taskProviders.set(type, provider);
        return new Disposable();
      },
      executeTask: (task: unknown) => {
        registry.executedTasks.push(task);
        return Promise.resolve({
          task,
          terminate: () => undefined,
        });
      },
      onDidStartTask: noEvent,
      onDidEndTask: noEvent,
      onDidStartTaskProcess: noEvent,
      onDidEndTaskProcess: noEvent,
    }),
    languages: recorded(registry, "languages", {
      registerHoverProvider: register("hover"),
      registerCompletionItemProvider: register("completion"),
      registerCodeLensProvider: register("codeLens"),
      registerDocumentFormattingEditProvider: register("formatting"),
      registerDocumentRangeFormattingEditProvider: register("rangeFormatting"),
      registerCodeActionsProvider: register("codeActions"),
      createLanguageStatusItem: statusItem,
    }),
    debug: recorded(registry, "debug", {
      onDidStartDebugSession: noEvent,
      onDidTerminateDebugSession: noEvent,
    }),
    extensions: recorded(registry, "extensions", {
      getExtension: () => undefined,
      all: [],
    }),
  });
};
