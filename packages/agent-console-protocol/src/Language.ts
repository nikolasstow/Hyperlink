/**
 * Language intelligence for an open file (docs/handoffs/code-intelligence.md):
 * the problems a language server finds in it, and the type at a place in it.
 * Served by the API server over a WebSocket at `path`, from real language
 * servers it runs on the Mac (TypeScript, with the Effect plugin).
 *
 * Places are offsets into the file's text in UTF-16 code units (what a native
 * text view counts), not lines and columns.
 *
 * @since 0.0.1
 */
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";

/** Where the RPC is served. */
export const path = "/language";

/** The language server's id for each file kind a server here knows, by
 * extension. */
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
export const languageOf = (path: string): string | undefined => LANGUAGES[/\.([^./]+)$/.exec(path)?.[1] ?? ""];

export const Severity = Schema.Literals(["error", "warning", "info", "hint"]);
export type Severity = typeof Severity.Type;

/** One problem, over a range of the text. */
export const Diagnostic = Schema.Struct({
  start: Schema.Number,
  end: Schema.Number,
  severity: Severity,
  message: Schema.String,
  /** Who found it (`typescript`, `effect`, …). */
  source: Schema.optionalKey(Schema.String),
  code: Schema.optionalKey(Schema.String),
});
export type Diagnostic = typeof Diagnostic.Type;

/** A file's problems, as of the hub's `version` of it (file-sync). */
export const FileDiagnostics = Schema.Struct({
  version: Schema.Number,
  diagnostics: Schema.Array(Diagnostic),
});
export type FileDiagnostics = typeof FileDiagnostics.Type;

/** What is at a place: Markdown (code in fenced blocks), over a range; and,
 * when it is named by a type that says less, that type spelled out one level
 * (its members: the dual form). */
export const HoverInfo = Schema.Struct({
  markdown: Schema.String,
  expanded: Schema.optionalKey(Schema.String),
  start: Schema.optionalKey(Schema.Number),
  end: Schema.optionalKey(Schema.Number),
});
export type HoverInfo = typeof HoverInfo.Type;

/** The file is not one a language server here knows (its language, or it is
 * outside every project), or the server could not run. */
export class LanguageError extends Schema.TaggedError<LanguageError>()("LanguageError", {
  reason: Schema.Literals(["Unsupported", "NotFound", "ServerFailed"]),
  message: Schema.String,
}) {}

/** A file's problems, now and as they change (follows the file while open). */
export class Diagnostics extends Rpc.make("Diagnostics", {
  payload: { path: Schema.String },
  success: FileDiagnostics,
  error: LanguageError,
  stream: true,
}) {}

/** What is at `offset` in the file, if anything. */
export class Hover extends Rpc.make("Hover", {
  payload: { path: Schema.String, offset: Schema.Number },
  success: Schema.Option(HoverInfo),
  error: LanguageError,
}) {}

export class LanguageRpcs extends RpcGroup.make(Diagnostics, Hover) {}

/**
 * A problem as an agent reads it: lines and columns from 1 (columns in
 * UTF-16 code units, as the editor counts).
 */
export const Problem = Schema.Struct({
  line: Schema.Number,
  column: Schema.Number,
  endLine: Schema.Number,
  endColumn: Schema.Number,
  severity: Severity,
  message: Schema.String,
  source: Schema.optionalKey(Schema.String),
  code: Schema.optionalKey(Schema.String),
});
export type Problem = typeof Problem.Type;

/** A file's problems once its check has settled: the ones the editor shows
 * for the hub's `version` of it. */
export const FileProblems = Schema.Struct({
  path: Schema.String,
  version: Schema.Number,
  problems: Schema.Array(Problem),
});
export type FileProblems = typeof FileProblems.Type;

/**
 * The `problems` endpoints, for agents (the opencode plugin, Dubz): the same
 * problems the editor shows, from the same language servers, never a check
 * of their own. `file` waits for the file's check to settle; `open` gives
 * every file open in a language server now.
 */
export const problemsGroup = HttpApiGroup.make("problems").add(
  HttpApiEndpoint.post("file", "/problems", { payload: Schema.Struct({ path: Schema.String }), success: FileProblems, error: LanguageError }),
  HttpApiEndpoint.get("open", "/problems/open", { success: Schema.Array(FileProblems), error: LanguageError }),
);

/** A file's problems as text for an agent: one line each, worst first. */
export const problemsText = (file: FileProblems): string => {
  if (file.problems.length === 0) return `No problems in ${file.path}.`;
  const order: ReadonlyArray<Severity> = ["error", "warning", "info", "hint"];
  const sorted = [...file.problems].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || a.line - b.line || a.column - b.column);
  const lines = sorted.map((problem) => {
    const from = [problem.source, problem.code].filter((part) => part !== undefined).join(" ");
    return `${problem.line}:${problem.column} ${problem.severity}${from === "" ? "" : ` (${from})`}: ${problem.message}`;
  });
  return [`Problems in ${file.path} (as the editor shows them):`, ...lines].join("\n");
};
