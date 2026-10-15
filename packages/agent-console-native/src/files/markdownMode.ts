/**
 * A Markdown file shows read (rendered) or write (the editor), toggled from the
 * file's top bar (MarkdownToggle in FilesScreen). Read is where one opens; the
 * choice is kept per file while the app runs.
 *
 * @internal
 */
import * as React from "react";

export type MarkdownMode = "read" | "write";

/** Whether a file is Markdown, by its name. */
export const isMarkdown = (name: string): boolean => /\.(md|markdown|mdx)$/i.test(name);

const modes = new Map<string, MarkdownMode>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const modeNow = (path: string): MarkdownMode => modes.get(path) ?? "read";

export const setMarkdownMode = (path: string, mode: MarkdownMode): void => {
  modes.set(path, mode);
  listeners.forEach((listener) => listener());
};

/** A file's mode, as it changes. */
export const useMarkdownMode = (path: string): MarkdownMode => React.useSyncExternalStore(subscribe, () => modeNow(path));
