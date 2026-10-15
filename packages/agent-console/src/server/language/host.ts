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

const SCRIPT = (() => {
  const require = createRequire(import.meta.url);
  return require.resolve("typescript-language-server/lib/cli.mjs");
})();

/** The language each file kind is, by extension. */
const LANGUAGES: Readonly<Record<string, string>> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascriptreact",
};

/** The language a file is, by its extension, when a server here knows it. */
const languageOf = (file: string): string | undefined => LANGUAGES[/\.([^./]+)$/.exec(file)?.[1] ?? ""];

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

/** A server's diagnostic over `doc`'s text. */
const diagnosticOf = (doc: Doc, diagnostic: LspDiagnostic): Language.Diagnostic => ({
  start: offsetOf(doc.text, doc.starts, diagnostic.range.start),
  end: offsetOf(doc.text, doc.starts, diagnostic.range.end),
  severity: SEVERITIES[(diagnostic.severity ?? 1) - 1] ?? "error",
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
      const docs = new Map<string, Doc>();
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
            const languageId = languageOf(file);
            if (languageId === undefined) return yield* unsupported(`No language server for ${path.basename(file)}.`);
            const uri = pathToFileURL(file).href;
            const ready = yield* Deferred.make<void, Language.LanguageError>();
            const show = (text: string, version: number) =>
              Effect.suspend(() => {
                const known = docs.get(file);
                docs.set(file, { uri, text, starts: lineStarts(text), version });
                return known === undefined
                  ? connection.notify("textDocument/didOpen", { textDocument: { uri, languageId, version, text } })
                  : connection.notify("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text }] });
              }).pipe(Effect.andThen(Deferred.succeed(ready, undefined)));
            yield* hub.follow(file).pipe(
              Stream.runForEach((event) => {
                if (event instanceof FileSync.Synced) return show(event.text, event.version);
                if (event instanceof FileSync.Changed) {
                  const known = docs.get(file);
                  return known === undefined ? Effect.void : show(TextChange.apply(known.text, event.changes), event.version);
                }
                return Effect.void;
              }),
              Effect.catch((error) => Deferred.fail(ready, new Language.LanguageError({ reason: "NotFound", message: error.message }))),
              Effect.forkScoped,
            );
            yield* Effect.addFinalizer(() =>
              Effect.suspend(() => {
                docs.delete(file);
                return connection.notify("textDocument/didClose", { textDocument: { uri } });
              }),
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
      if (languageOf(requested) === undefined) return yield* unsupported(`No language server for ${path.basename(requested)}.`);
      const file = yield* resolveWithin(requested).pipe(
        Effect.mapError((error) => new Language.LanguageError({ reason: "NotFound", message: `${error.reason}: ${error.path}` })),
        Effect.provide(services),
      );
      const server = yield* RcMap.get(servers, yield* repoOf(file));
      const uri = yield* RcMap.get(server.files, file);
      return { file, uri, server };
    });

  return {
    /** A file's problems, now and as they change, while the stream runs. */
    diagnostics: (requested: string): Stream.Stream<Language.FileDiagnostics, Language.LanguageError> =>
      Stream.unwrap(
        Effect.gen(function* () {
          const { file, uri, server } = yield* open(requested);
          return SubscriptionRef.changes(server.problems).pipe(
            Stream.map((all) => all.get(uri)),
            Stream.changes,
            Stream.map((found): Language.FileDiagnostics | undefined => {
              const doc = server.docs.get(file);
              return found === undefined || doc === undefined ? undefined : { version: doc.version, diagnostics: found.map((diagnostic) => diagnosticOf(doc, diagnostic)) };
            }),
            Stream.filter((next): next is Language.FileDiagnostics => next !== undefined),
          );
        }),
      ),
    /** What is at `offset` in a file, if anything. */
    hover: (requested: string, offset: number): Effect.Effect<Option.Option<Language.HoverInfo>, Language.LanguageError> =>
      Effect.gen(function* () {
        const { file, uri, server } = yield* open(requested);
        const doc = server.docs.get(file);
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
