/**
 * Changing a package.json's scripts without reformatting the file.
 *
 * Only the `scripts` object is rewritten, in the file's own indentation and
 * line endings; every other byte stays as it was, so a script edit is a
 * one-line diff rather than a reformatted file. Script order is kept: an
 * edited script stays where it was, a new one goes last.
 *
 * @internal
 */
import { Effect, Schema } from "effect";

/** Why a scripts change could not be made. */
export class ScriptsEditError extends Schema.TaggedErrorClass<ScriptsEditError>()("ScriptsEditError", {
  message: Schema.String,
}) {}

const editError = (message: string) => new ScriptsEditError({ message });

const jsonString = Schema.fromJsonString(Schema.String);
const scriptsJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));

/** A top-level key of the root object: where its key starts and where its
 * value starts and ends. */
interface KeySpan {
  readonly key: string;
  readonly keyStart: number;
  readonly valueStart: number;
  readonly valueEnd: number;
}

const isSpace = (char: string | undefined) => char === " " || char === "\t" || char === "\n" || char === "\r";

const skipSpace = (text: string, from: number): number => {
  let at = from;
  while (at < text.length && isSpace(text[at])) at += 1;
  return at;
};

/** The index just past the string starting at `from` (a `"`). */
const skipString = (text: string, from: number): number => {
  let at = from + 1;
  while (at < text.length) {
    if (text[at] === "\\") at += 2;
    else if (text[at] === '"') return at + 1;
    else at += 1;
  }
  return at;
};

/** The index just past the JSON value starting at `from`. */
const skipValue = (text: string, from: number): number => {
  const first = text[from];
  if (first === '"') return skipString(text, from);
  if (first === "{" || first === "[") {
    let depth = 0;
    let at = from;
    while (at < text.length) {
      const char = text[at];
      if (char === '"') {
        at = skipString(text, at);
        continue;
      }
      if (char === "{" || char === "[") depth += 1;
      if (char === "}" || char === "]") {
        depth -= 1;
        if (depth === 0) return at + 1;
      }
      at += 1;
    }
    return at;
  }
  let at = from;
  while (at < text.length && text[at] !== "," && text[at] !== "}" && text[at] !== "]" && !isSpace(text[at])) at += 1;
  return at;
};

/** The root object's keys, in order, and where the root object closes. */
const topLevel = (text: string): Effect.Effect<{ readonly keys: ReadonlyArray<KeySpan>; readonly close: number }, ScriptsEditError> =>
  Effect.gen(function* () {
    const open = skipSpace(text, 0);
    if (text[open] !== "{") return yield* editError("package.json is not a JSON object");
    const keys: Array<KeySpan> = [];
    let at = skipSpace(text, open + 1);
    while (at < text.length && text[at] !== "}") {
      if (text[at] === ",") {
        at = skipSpace(text, at + 1);
        continue;
      }
      if (text[at] !== '"') return yield* editError(`package.json has something unexpected at offset ${at}`);
      const keyStart = at;
      const keyEnd = skipString(text, at);
      const key = yield* Schema.decodeUnknownEffect(jsonString)(text.slice(keyStart, keyEnd)).pipe(Effect.mapError((cause) => editError(`package.json: ${cause.message}`)));
      const colon = skipSpace(text, keyEnd);
      if (text[colon] !== ":") return yield* editError(`package.json has no ":" after "${key}"`);
      const valueStart = skipSpace(text, colon + 1);
      const valueEnd = skipValue(text, valueStart);
      keys.push({
        key,
        keyStart,
        valueStart,
        valueEnd,
      });
      at = skipSpace(text, valueEnd);
    }
    if (text[at] !== "}") return yield* editError("package.json ends before its root object closes");
    return {
      keys,
      close: at,
    };
  });

/** The whitespace a line starts with, for the line holding `offset`. */
const indentAt = (text: string, offset: number): string => {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? "";
};

const encodeString = (value: string) => Schema.encodeEffect(jsonString)(value).pipe(Effect.mapError((cause) => editError(cause.message)));

/** A scripts object in the file's style: one script per line, one level in
 * from `indent`. */
const scriptsBlock = (entries: ReadonlyArray<readonly [string, string]>, indent: string, unit: string, newline: string) =>
  entries.length === 0
    ? Effect.succeed("{}")
    : Effect.forEach(entries, ([name, command]) =>
        Effect.all([encodeString(name), encodeString(command)]).pipe(Effect.map(([key, value]) => `${indent}${unit}${key}: ${value}`)),
      ).pipe(Effect.map((lines) => `{${newline}${lines.join(`,${newline}`)}${newline}${indent}}`));

/** The scripts a package.json declares, in order. */
export const readScripts = (text: string) =>
  topLevel(text).pipe(
    Effect.flatMap(({ keys }) => {
      const span = keys.find((key) => key.key === "scripts");
      return span === undefined
        ? Effect.succeed<ReadonlyArray<readonly [string, string]>>([])
        : Schema.decodeUnknownEffect(scriptsJson)(text.slice(span.valueStart, span.valueEnd)).pipe(
            Effect.map((scripts): ReadonlyArray<readonly [string, string]> => Object.entries(scripts)),
            Effect.mapError((cause) => editError(`package.json's scripts: ${cause.message}`)),
          );
    }),
  );

/** `text` with its scripts replaced by `entries`; a file with no scripts gets
 * them as its last key. */
export const writeScripts = (text: string, entries: ReadonlyArray<readonly [string, string]>) =>
  Effect.gen(function* () {
    const { keys, close } = yield* topLevel(text);
    const newline = text.includes("\r\n") ? "\r\n" : "\n";
    const span = keys.find((key) => key.key === "scripts");
    if (span !== undefined) {
      const indent = indentAt(text, span.keyStart);
      const block = yield* scriptsBlock(entries, indent, indent.length === 0 ? "  " : indent, newline);
      return `${text.slice(0, span.valueStart)}${block}${text.slice(span.valueEnd)}`;
    }
    const last = keys.at(-1);
    if (last === undefined) {
      const block = yield* scriptsBlock(entries, "  ", "  ", newline);
      return `${text.slice(0, close)}${newline}  "scripts": ${block}${newline}${text.slice(close)}`;
    }
    const indent = indentAt(text, last.keyStart);
    const block = yield* scriptsBlock(entries, indent, indent.length === 0 ? "  " : indent, newline);
    return `${text.slice(0, last.valueEnd)},${newline}${indent}"scripts": ${block}${text.slice(last.valueEnd)}`;
  });

/** What to do to one script. `previous` names the script being edited; without
 * it, `name` is a new script. */
export interface ScriptChange {
  readonly previous?: string;
  readonly name: string;
  readonly command: string;
}

/** The scripts after a change: an edited script keeps its place (renamed or
 * not), a new one goes last. A name another script has is refused. */
export const changeScripts = (
  entries: ReadonlyArray<readonly [string, string]>,
  change: ScriptChange,
): Effect.Effect<ReadonlyArray<readonly [string, string]>, ScriptsEditError> =>
  Effect.gen(function* () {
    const name = change.name.trim();
    const command = change.command.trim();
    if (name.length === 0) return yield* editError("a script needs a name");
    if (/\s/.test(name)) return yield* editError(`"${name}" has spaces; a script name cannot`);
    if (command.length === 0) return yield* editError("a script needs a command");
    if (name !== change.previous && entries.some(([existing]) => existing === name)) return yield* editError(`there is already a script named "${name}"`);
    const script: readonly [string, string] = [name, command];
    if (change.previous === undefined) return [...entries, script];
    if (!entries.some(([existing]) => existing === change.previous)) return yield* editError(`there is no script named "${change.previous}" any more`);
    return entries.map(([existing, current]): readonly [string, string] => (existing === change.previous ? script : [existing, current]));
  });
