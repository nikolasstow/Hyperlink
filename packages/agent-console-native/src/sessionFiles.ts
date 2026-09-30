/**
 * The files an agent has been touching in a session: the files its tools read
 * or changed, newest first, each once. From the transcript's tool calls: a
 * tool naming a file does so as `filePath` (read, edit, write); tools taking a
 * folder (list, glob, grep) name it as `path`, and are left out.
 *
 * @internal
 */

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

/** The part of a transcript read here: its messages' parts, and their order
 * (a Transcript is one). */
export interface PartsSource {
  readonly order: ReadonlyArray<string>;
  readonly messages: ReadonlyMap<
    string,
    {
      readonly parts: ReadonlyMap<string, { readonly type: string; readonly tool?: string; readonly state?: { readonly input?: unknown } }>;
    }
  >;
}

/** The session's files, newest first, each once (edited if any tool changed it). */
export const sessionFiles = (transcript: PartsSource, directory: string | undefined): ReadonlyArray<SessionFile> => {
  const seen = new Map<string, SessionFile>();
  const order = [...transcript.order].reverse();
  for (const id of order) {
    const message = transcript.messages.get(id);
    if (message === undefined) continue;
    for (const part of [...message.parts.values()].reverse()) {
      if (part.type !== "tool" || part.tool === undefined) continue;
      const file = fileOf(part.state?.input);
      if (file === undefined) continue;
      const path = absolute(file, directory);
      const edited = EDITING_TOOLS.has(part.tool);
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

/** How a file is referenced in a message: `@` and its path, relative to the
 * session's folder when inside it. */
export const mentionOf = (file: SessionFile, directory: string | undefined): string => {
  const root = directory?.replace(/\/+$/, "");
  const relative = root !== undefined && file.path.startsWith(`${root}/`) ? file.path.slice(root.length + 1) : file.path;
  return `@${relative}`;
};
