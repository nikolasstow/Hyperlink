/**
 * Language servers for the files the app has open (docs/handoffs/
 * code-intelligence.md, layer 3 hosted here): one `typescript-language-server`
 * per repo (the folder holding `.git`), using the repo's own TypeScript, so its
 * `tsconfig.json` plugins load (`@effect/language-service`).
 *
 * A file's text comes from the file hub (files/hub.ts): the host follows the
 * file there, as the app does, and keeps the server's copy in step with every
 * version. The server's problems for it come back as offsets into that text
 * (agent-console-protocol `Language`).
 *
 * A repo's server starts on first use and stops a while after its last file
 * closes; a file stays open in it a moment after its last asker goes.
 *
 * @internal
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Language } from "agent-console-protocol";
import { Deferred, Duration, Effect, FileSystem, Layer, Context, Option, Path, RcMap, Schema, Stream, SubscriptionRef } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import { FileSync, TextChange } from "file-sync";
import { resolveWithin } from "../fs";
import { FileHub } from "../files/hub";
import { connect, type Connection } from "./connection";
import { lineStarts, offsetOf, positionOf } from "./positions";

/** How long a repo's server runs after its last file closes. */
const KEEP_SERVER = Duration.minutes(5);
/** How long a file stays open in its server after its last asker goes. */
const KEEP_FILE = Duration.seconds(30);
/** A check has settled when the server publishes nothing new for this long. */
const QUIET = Duration.millis(600);
/** How long a check is waited for at most; then the problems shown now. */
const SETTLE_MAX = Duration.seconds(10);

const SCRIPT = (() => {
  const require = createRequire(import.meta.url);
  return require.resolve("typescript-language-server/lib/cli.mjs");
})();

/** A file as its server has it. */
interface Doc {
  readonly uri: string;
  readonly text: string;
  readonly starts: ReadonlyArray<number>;
  readonly version: number;
}

const LspPosition = Schema.Struct({ line: Schema.Number, character: Schema.Number });
const LspRange = Schema.Struct({ start: LspPosition, end: LspPosition });
const LspDiagnostic = Schema.Struct({
  range: LspRange,
  severity: Schema.optional(Schema.Number),
  message: Schema.String,
  source: Schema.optional(Schema.String),
  code: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
});
type LspDiagnostic = typeof LspDiagnostic.Type;
const decodePublished = Schema.decodeUnknownOption(Schema.Struct({ uri: Schema.String, diagnostics: Schema.Array(LspDiagnostic) }));

const MarkedString = Schema.Union([Schema.String, Schema.Struct({ language: Schema.String, value: Schema.String })]);
const HoverResult = Schema.NullOr(
  Schema.Struct({
    contents: Schema.Union([Schema.Struct({ kind: Schema.String, value: Schema.String }), MarkedString, Schema.Array(MarkedString)]),
    range: Schema.optional(LspRange),
  }),
);
const decodeHover = Schema.decodeUnknownEffect(HoverResult);

const SEVERITIES: ReadonlyArray<Language.Severity> = ["error", "warning", "info", "hint"];

const Completions = Schema.Union([
  Schema.Array(Schema.Struct({ label: Schema.String, detail: Schema.optional(Schema.String) })),
  Schema.Struct({ items: Schema.Array(Schema.Struct({ label: Schema.String, detail: Schema.optional(Schema.String) })) }),
  Schema.Null,
]);
const decodeCompletions = Schema.decodeUnknownOption(Completions);
const SignatureHelp = Schema.NullOr(
  Schema.Struct({
    signatures: Schema.Array(Schema.Struct({ label: Schema.String })),
    activeSignature: Schema.optional(Schema.Number),
  }),
);
const decodeSignatureHelp = Schema.decodeUnknownOption(SignatureHelp);

/** What the language server knows at a place, for an inline suggestion's
 * prompt: the call being typed in, and the names valid there. */
export interface PlaceContext {
  readonly signature?: string;
  readonly names: ReadonlyArray<string>;
}

/** How many names a suggestion's prompt is given. */
const NAMES = 40;
/** How much of the text before the caret finds the caret in the server's copy. */
const ANCHOR = 160;

const severityOf = (diagnostic: LspDiagnostic): Language.Severity => SEVERITIES[(diagnostic.severity ?? 1) - 1] ?? "error";

/** A server's diagnostic over `doc`'s text. */
const diagnosticOf = (doc: Doc, diagnostic: LspDiagnostic): Language.Diagnostic => ({
  start: offsetOf(doc.text, doc.starts, diagnostic.range.start),
  end: offsetOf(doc.text, doc.starts, diagnostic.range.end),
  severity: severityOf(diagnostic),
  message: diagnostic.message,
  ...(diagnostic.source === undefined ? {} : { source: diagnostic.source }),
  ...(diagnostic.code === undefined ? {} : { code: String(diagnostic.code) }),
});

/** A server's diagnostic as an agent reads it (lines and columns from 1). */
const problemOf = (diagnostic: LspDiagnostic): Language.Problem => ({
  line: diagnostic.range.start.line + 1,
  column: diagnostic.range.start.character + 1,
  endLine: diagnostic.range.end.line + 1,
  endColumn: diagnostic.range.end.character + 1,
  severity: severityOf(diagnostic),
  message: diagnostic.message,
  ...(diagnostic.source === undefined ? {} : { source: diagnostic.source }),
  ...(diagnostic.code === undefined ? {} : { code: String(diagnostic.code) }),
});

/** Hover contents, in any of the protocol's forms, as Markdown. */
const markdownOf = (contents: typeof MarkedString.Type | ReadonlyArray<typeof MarkedString.Type> | { readonly kind: string; readonly value: string }): string => {
  const one = (part: typeof MarkedString.Type): string => (typeof part === "string" ? part : `\`\`\`${part.language}\n${part.value}\n\`\`\``);
  if (typeof contents === "string") return contents;
  if ("kind" in contents) return contents.value;
  if ("language" in contents) return one(contents);
  return contents.map(one).join("\n\n");
};

const unsupported = (message: string) => new Language.LanguageError({ reason: "Unsupported", message });
const serverFailed = (message: string) => new Language.LanguageError({ reason: "ServerFailed", message });

const make = Effect.gen(function* () {
  const hub = yield* FileHub;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const services = yield* Effect.context<FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner>();

  /** The repo `file` is in: the nearest folder up holding `.git`. */
  const repoOf = (file: string): Effect.Effect<string, Language.LanguageError> =>
    Effect.gen(function* () {
      let dir = path.dirname(file);
      for (;;) {
        if (yield* fs.exists(path.join(dir, ".git")).pipe(Effect.orElseSucceed(() => false))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) return yield* unsupported(`${file} is in no repo.`);
        dir = parent;
      }
    });

  /** The files open in a server now: what the editor shows problems for,
   * and files agents just checked. */
  const opened = new Set<string>();

  /** A repo's server: started, initialized, and its files and problems. */
  const startServer = (root: string) =>
    Effect.gen(function* () {
      const connection: Connection = yield* connect(SCRIPT, root);
      const rootUri = pathToFileURL(root).href;
      yield* connection.request("initialize", {
        processId: process.pid,
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: path.basename(root) }],
        capabilities: {
          textDocument: {
            synchronization: { didSave: false },
            publishDiagnostics: { versionSupport: true },
            hover: { contentFormat: ["markdown", "plaintext"] },
          },
          workspace: { configuration: true, workspaceFolders: true },
        },
      });
      yield* connection.notify("initialized", {});
      const docs = yield* SubscriptionRef.make<ReadonlyMap<string, Doc>>(new Map());
      const problems = yield* SubscriptionRef.make<ReadonlyMap<string, ReadonlyArray<LspDiagnostic>>>(new Map());
      yield* connection.notifications.pipe(
        Stream.runForEach((notification) =>
          notification.method !== "textDocument/publishDiagnostics"
            ? Effect.void
            : Option.match(decodePublished(notification.params), {
                onNone: () => Effect.logWarning("[language] unreadable diagnostics"),
                onSome: ({ uri, diagnostics }) => SubscriptionRef.update(problems, (all) => new Map(all).set(uri, diagnostics)),
              }),
        ),
        Effect.forkScoped,
      );

      /** Keeps `file` open in the server, in step with the hub, while held;
       * settles once the server has its first text. */
      const files = yield* RcMap.make({
        lookup: (file: string) =>
          Effect.gen(function* () {
            const languageId = Language.languageOf(file);
            if (languageId === undefined) return yield* unsupported(`No language server for ${path.basename(file)}.`);
            const uri = pathToFileURL(file).href;
            const ready = yield* Deferred.make<void, Language.LanguageError>();
            const show = (text: string, version: number) =>
              Effect.gen(function* () {
                const known = (yield* SubscriptionRef.get(docs)).get(file);
                yield* known === undefined
                  ? connection.notify("textDocument/didOpen", { textDocument: { uri, languageId, version, text } })
                  : connection.notify("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text }] });
                // After the server has it: a check waiting for this version
                // asks the server only once it is there.
                yield* SubscriptionRef.update(docs, (all) => new Map(all).set(file, { uri, text, starts: lineStarts(text), version }));
              }).pipe(Effect.andThen(Deferred.succeed(ready, undefined)));
            yield* hub.follow(file).pipe(
              Stream.runForEach((event) => {
                if (event instanceof FileSync.Synced) return show(event.text, event.version);
                if (event instanceof FileSync.Changed) {
                  return SubscriptionRef.get(docs).pipe(
                    Effect.flatMap((all) => {
                      const known = all.get(file);
                      return known === undefined ? Effect.void : show(TextChange.apply(known.text, event.changes), event.version);
                    }),
                  );
                }
                return Effect.void;
              }),
              Effect.catch((error) => Deferred.fail(ready, new Language.LanguageError({ reason: "NotFound", message: error.message }))),
              Effect.forkScoped,
            );
            opened.add(file);
            yield* Effect.addFinalizer(() =>
              SubscriptionRef.update(docs, (all) => {
                const next = new Map(all);
                next.delete(file);
                return next;
              }).pipe(
                Effect.andThen(Effect.sync(() => opened.delete(file))),
                Effect.andThen(connection.notify("textDocument/didClose", { textDocument: { uri } })),
              ),
            );
            yield* Deferred.await(ready);
            return uri;
          }),
        idleTimeToLive: KEEP_FILE,
      });
      return { connection, docs, problems, files };
    }).pipe(Effect.mapError((error) => serverFailed(error.message)));

  const servers = yield* RcMap.make({
    lookup: (root: string) => startServer(root).pipe(Effect.provide(services)),
    idleTimeToLive: KEEP_SERVER,
  });

  /** `requested`'s real path, its server, and the file held open in it. */
  const open = (requested: string) =>
    Effect.gen(function* () {
      if (Language.languageOf(requested) === undefined) return yield* unsupported(`No language server for ${path.basename(requested)}.`);
      const file = yield* resolveWithin(requested).pipe(
        Effect.mapError((error) => new Language.LanguageError({ reason: "NotFound", message: `${error.reason}: ${error.path}` })),
        Effect.provide(services),
      );
      const server = yield* RcMap.get(servers, yield* repoOf(file));
      const uri = yield* RcMap.get(server.files, file);
      return { file, uri, server };
    });

  /**
   * A file's problems once its check has settled: the editor's problems
   * for the text on disk now (an agent's edit included). Waits until the
   * server has that version, has checked it (a request the server answers
   * only after the check), and then publishes nothing new for `QUIET`.
   */
  const problems = (requested: string): Effect.Effect<Language.FileProblems, Language.LanguageError> =>
    Effect.gen(function* () {
      const { file, uri, server } = yield* open(requested);
      const target = yield* hub.version(file).pipe(Effect.mapError((error) => new Language.LanguageError({ reason: "NotFound", message: `${error.reason}: ${error.path}` })));
      yield* SubscriptionRef.changes(server.docs).pipe(
        Stream.filter((docs) => (docs.get(file)?.version ?? -1) >= target),
        Stream.runHead,
        Effect.timeoutOrElse({ duration: SETTLE_MAX, orElse: () => Effect.logWarning(`[language] ${file} version ${target} not in its server yet`) }),
      );
      yield* server.connection
        .request("workspace/executeCommand", { command: "typescript.tsserverRequest", arguments: ["semanticDiagnosticsSync", { file }] })
        .pipe(Effect.catch((error) => Effect.logDebug(`[language] checking ${file} first failed`, error)));
      yield* SubscriptionRef.changes(server.problems).pipe(
        Stream.map((all) => all.get(uri)),
        Stream.changes,
        Stream.debounce(QUIET),
        Stream.runHead,
        Effect.timeoutOrElse({ duration: SETTLE_MAX, orElse: () => Effect.logWarning(`[language] ${file} check did not settle`) }),
      );
      const doc = (yield* SubscriptionRef.get(server.docs)).get(file);
      const found = (yield* SubscriptionRef.get(server.problems)).get(uri) ?? [];
      return { path: file, version: doc?.version ?? target, problems: found.map(problemOf) };
    }).pipe(Effect.scoped);

  return {
    /** A file's problems, now and as they change, while the stream runs. */
    diagnostics: (requested: string): Stream.Stream<Language.FileDiagnostics, Language.LanguageError> =>
      Stream.unwrap(
        Effect.gen(function* () {
          const { file, uri, server } = yield* open(requested);
          return SubscriptionRef.changes(server.problems).pipe(
            Stream.map((all) => all.get(uri)),
            Stream.changes,
            Stream.mapEffect((found) =>
              SubscriptionRef.get(server.docs).pipe(
                Effect.map((docs): Language.FileDiagnostics | undefined => {
                  const doc = docs.get(file);
                  return found === undefined || doc === undefined ? undefined : { version: doc.version, diagnostics: found.map((diagnostic) => diagnosticOf(doc, diagnostic)) };
                }),
              ),
            ),
            Stream.filter((next): next is Language.FileDiagnostics => next !== undefined),
          );
        }),
      ),
    problems,
    /** The problems of every file open in a language server now, settled. */
    openProblems: Effect.suspend(() => Effect.forEach([...opened], problems, { concurrency: "unbounded" })),
    /** What is at `offset` in a file, if anything. */
    /**
     * What the server knows where `prefix` ends (the text before an app's
     * caret, maybe unsaved): found in its copy by the end of `prefix`, then
     * the call being typed in and the names valid there. Empty when the place
     * is not in its copy (edits not saved yet) or the file is no server's.
     */
    contextAt: (requested: string, prefix: string): Effect.Effect<PlaceContext> =>
      Effect.gen(function* () {
        const { file, uri, server } = yield* open(requested);
        const doc = (yield* SubscriptionRef.get(server.docs)).get(file);
        const anchor = prefix.slice(-ANCHOR);
        const at = doc === undefined || anchor === "" ? -1 : doc.text.lastIndexOf(anchor);
        if (doc === undefined || at === -1) return { names: [] };
        const position = positionOf(doc.starts, at + anchor.length);
        const [signature, completions] = yield* Effect.all(
          [
            server.connection.request("textDocument/signatureHelp", { textDocument: { uri }, position }).pipe(Effect.map(decodeSignatureHelp)),
            server.connection.request("textDocument/completion", { textDocument: { uri }, position, context: { triggerKind: 1 } }).pipe(Effect.map(decodeCompletions)),
          ],
          { concurrency: "unbounded" },
        );
        const help = Option.getOrNull(signature);
        const label = help === null ? undefined : help.signatures[help.activeSignature ?? 0]?.label;
        const found = Option.getOrNull(completions);
        const items = found === null ? [] : Array.isArray(found) ? found : "items" in found ? found.items : [];
        const names = items.slice(0, NAMES).map((item) => (item.detail === undefined ? item.label : `${item.label}: ${item.detail}`));
        return label === undefined ? { names } : { signature: label, names };
      }).pipe(
        Effect.scoped,
        Effect.catch((error) => Effect.logDebug(`[language] no context in ${requested}`, error).pipe(Effect.as({ names: [] }))),
      ),
    hover: (requested: string, offset: number): Effect.Effect<Option.Option<Language.HoverInfo>, Language.LanguageError> =>
      Effect.gen(function* () {
        const { file, uri, server } = yield* open(requested);
        const doc = (yield* SubscriptionRef.get(server.docs)).get(file);
        if (doc === undefined) return Option.none();
        const answer = yield* server.connection.request("textDocument/hover", { textDocument: { uri }, position: positionOf(doc.starts, offset) }).pipe(
          Effect.flatMap(decodeHover),
          Effect.mapError((error) => serverFailed(error.message)),
        );
        if (answer === null) return Option.none();
        const markdown = markdownOf(answer.contents).trim();
        if (markdown === "") return Option.none();
        return Option.some(
          answer.range === undefined
            ? { markdown }
            : { markdown, start: offsetOf(doc.text, doc.starts, answer.range.start), end: offsetOf(doc.text, doc.starts, answer.range.end) },
        );
      }).pipe(Effect.scoped),
  };
});

/** The language servers. Needs the file hub, and Node's file system, paths and
 * processes. */
export class LanguageHost extends Context.Service<LanguageHost, Effect.Success<typeof make>>()("agent-console/server/language/host/LanguageHost") {
  static readonly layer = Layer.effect(LanguageHost, make);
}
