/**
 * What the shared explorer browses: a file source. The repo's files on the
 * agent-console server are one source (files/repoSource.ts); a plugin's file
 * system over the files-v1 HTTP contract is another (httpFileSource.ts), the
 * printer's storage first. The explorer draws any source the same way.
 *
 * A source gives folders by path, and may give more: its storage areas (the
 * tabs of the explorer home) and its recent files. How rows look beyond the
 * name and icon (a thumbnail, a line under the name, a badge) comes with the
 * entries, so the explorer needs no knowledge of the source. Menus and marks
 * that hang on the host's own state (favorites, unsaved files) are the host's
 * (Explorer's `menu` and `marks`).
 *
 * See docs/handoffs/plugin-devices-files-editors.md.
 *
 * @internal
 */
import { Data, type Effect } from "effect";
import type { HttpClient } from "effect/http";

/** One row of a folder. `kind` uses the server's words, as `FileNavEntry` does. */
export interface FileSourceEntry {
  readonly path: string;
  readonly name: string;
  readonly kind: "file" | "directory";
  /** A line under the name, such as the size and when it was last printed. */
  readonly detail?: string;
  /** An image the row shows in place of the file's icon. */
  readonly thumbnail?: string;
  /** A short capsule at the end of the row, such as "Printing". */
  readonly badge?: string;
}

/** A folder's entries, or the folder is not there. */
export type FileSourceListing = { readonly _tag: "Found"; readonly entries: ReadonlyArray<FileSourceEntry> } | { readonly _tag: "Missing" };

/** A storage area of a source: a tab of the explorer home. `saveInto` is where a saved file can go. */
export interface FileSourceRoot {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly available: boolean;
  /** Why it cannot be opened now, when it cannot. */
  readonly reason: string | undefined;
  readonly saveInto: "Anywhere" | "Top" | "None";
  readonly newFolder: boolean;
}

/** Why a source could not answer: no connection, an error status, or a reply it could not read. */
export class FileSourceError extends Data.TaggedError("FileSourceError")<{
  readonly reason: "Transport" | "Http" | "Decode";
  readonly path: string;
  readonly status?: number;
  readonly message: string;
}> {}

/** Files the source lists first on its home, such as recent prints. */
export interface FileSourceRecent {
  readonly title: string;
  readonly load: Effect.Effect<ReadonlyArray<FileSourceEntry>, FileSourceError, HttpClient.HttpClient>;
}

export interface FileSource {
  /** Unique among sources, and stable: listings are cached under it. */
  readonly id: string;
  /** The folder's entries as last loaded, so a folder paints at once. */
  readonly cached: (path: string) => ReadonlyArray<FileSourceEntry> | undefined;
  /** Loads a folder (and keeps it for `cached`). */
  readonly list: (path: string) => Effect.Effect<FileSourceListing, FileSourceError, HttpClient.HttpClient>;
  /** The storage areas, for a source with more than one. */
  readonly roots?: Effect.Effect<ReadonlyArray<FileSourceRoot>, FileSourceError, HttpClient.HttpClient>;
  readonly recent?: FileSourceRecent;
}
