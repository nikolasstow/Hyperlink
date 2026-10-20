/**
 * The explorer tree's rows, worked out from what is loaded and open: pure,
 * so it is tested without a device (useSourceTree.ts holds the state).
 *
 * @internal
 */
import type { FileSourceEntry } from "./FileSource";

export interface SourceRow extends FileSourceEntry {
  /** Nesting depth for indentation; the root's entries are 0. */
  readonly depth: number;
  readonly expanded: boolean;
  readonly loading: boolean;
  readonly failed: boolean;
}

/** What the tree has loaded, and which folders are open, loading, or failed. */
export interface TreeState {
  readonly children: ReadonlyMap<string, ReadonlyArray<FileSourceEntry>>;
  readonly expanded: ReadonlySet<string>;
  readonly loading: ReadonlySet<string>;
  readonly failed: ReadonlySet<string>;
}

export const emptyTree: TreeState = {
  children: new Map(),
  expanded: new Set(),
  loading: new Set(),
  failed: new Set(),
};

/** The rows of the tree under `root`: each entry, and the entries of each expanded folder under it. */
export const flattenRows = (state: TreeState, root: string): ReadonlyArray<SourceRow> => {
  const walk = (dir: string, depth: number): ReadonlyArray<SourceRow> =>
    (state.children.get(dir) ?? []).flatMap((entry) => {
      const expanded = state.expanded.has(entry.path);
      const row: SourceRow = {
        ...entry,
        depth,
        expanded,
        loading: state.loading.has(entry.path),
        failed: state.failed.has(entry.path),
      };
      return entry.kind === "directory" && expanded ? [row, ...walk(entry.path, depth + 1)] : [row];
    });
  return walk(root, 0);
};
