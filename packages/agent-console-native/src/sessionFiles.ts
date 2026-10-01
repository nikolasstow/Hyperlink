/**
 * The files an agent has been touching in a session: the files its tools read
 * or changed, newest first, each once. From the chat's tool calls (either
 * protocol, chat/model.ts): a tool naming a file does so as `filePath` (read,
 * edit, write); tools taking a folder (list, glob, grep) name it as `path`,
 * and are left out.
 *
 * @internal
 */
import type { ChatMessage } from "./chat/model";

/** A file the agent touched. */
export interface SessionFile {
  /** Absolute. */
  readonly path: string;
  readonly name: string;
  /** Changed (edited or written), not only read. */
  readonly edited: boolean;
}

const EDITING_TOOLS = new Set(["edit", "write", "multiedit", "patch"]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const fileOf = (input: unknown): string | undefined => {
  if (!isRecord(input)) return undefined;
  for (const key of ["filePath", "file_path"]) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
};

/** `path` made absolute against the session's folder. */
const absolute = (path: string, directory: string | undefined): string =>
  path.startsWith("/") || path.startsWith("~") || directory === undefined ? path : `${directory.replace(/\/+$/, "")}/${path}`;

/** The session's files, newest first, each once (edited if any tool changed it). */
export const sessionFiles = (messages: ReadonlyArray<ChatMessage>, directory: string | undefined): ReadonlyArray<SessionFile> => {
  const seen = new Map<string, SessionFile>();
  for (const message of [...messages].reverse()) {
    for (const part of [...message.parts].reverse()) {
      if (part.kind !== "tool") continue;
      const file = fileOf(part.input);
      if (file === undefined) continue;
      const path = absolute(file, directory);
      const edited = EDITING_TOOLS.has(part.name);
      const known = seen.get(path);
      if (known === undefined) {
        seen.set(path, {
          path,
          name: path.split("/").filter(Boolean).pop() ?? path,
          edited,
        });
      } else if (edited && !known.edited) {
        seen.set(path, {
          ...known,
          edited: true,
        });
      }
    }
  }
  return [...seen.values()];
};
