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

/** What is at a place: Markdown (code in fenced blocks), over a range. */
export const HoverInfo = Schema.Struct({
  markdown: Schema.String,
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
