/**
 * The explorer's lazy, expandable tree over a file source: the data behind
 * the iOS Files-style outline. A folder loads its children on first expand,
 * and the expanded set is flattened into a depth-tagged row list. Collapsing
 * keeps loaded children, so opening a folder again is instant.
 *
 * Listings are cache-first: a folder the source already has (a previous
 * visit, an earlier expand, a prefetch) paints at once with no spinner, then
 * refreshes in the background. A failed load marks that folder failed (shown
 * in its row as a retry), never drops it silently.
 *
 * @internal
 */
import * as React from "react";
import { runFs } from "../effect/runtime";
import type { FileSource, FileSourceEntry } from "./FileSource";
import { emptyTree, flattenRows, type SourceRow, type TreeState } from "./sourceRows";


/** The tree for `root` as the source last had it, so a known folder paints with no spinner. */
const seed = (source: FileSource, root: string): TreeState => {
  const cached = source.cached(root);
  return cached === undefined ? emptyTree : { ...emptyTree, children: new Map([[root, cached]]) };
};

export interface SourceTree {
  readonly rows: ReadonlyArray<SourceRow>;
  readonly rootLoading: boolean;
  readonly rootFailed: boolean;
  /** A short reason for a failed root load, for display. */
  readonly rootError: string | undefined;
  readonly toggle: (row: SourceRow) => void;
  /** Loads the root again (and the folders open under it from cache). */
  readonly reload: () => void;
}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const useSourceTree = (source: FileSource, root: string): SourceTree => {
  const [state, setState] = React.useState<TreeState>(() => seed(source, root));
  const [rootError, setRootError] = React.useState<string | undefined>(undefined);

  const show = React.useCallback((dir: string, entries: ReadonlyArray<FileSourceEntry>): void => {
    setState((prev) => {
      const children = new Map(prev.children);
      children.set(dir, entries);
      const loading = new Set(prev.loading);
      loading.delete(dir);
      const failed = new Set(prev.failed);
      failed.delete(dir);
      return { ...prev, children, loading, failed };
    });
  }, []);

  const markFailed = React.useCallback((dir: string): void => {
    setState((prev) => {
      const loading = new Set(prev.loading);
      loading.delete(dir);
      const failed = new Set(prev.failed);
      failed.add(dir);
      // Collapse it, so its row shows a retry rather than an open, empty folder.
      const expanded = new Set(prev.expanded);
      expanded.delete(dir);
      return { ...prev, loading, failed, expanded };
    });
  }, []);

  const load = React.useCallback(
    (dir: string): void => {
      const cached = source.cached(dir);
      if (cached !== undefined) {
        // Paint from the cache now, then refresh; a failed refresh keeps the cached listing.
        show(dir, cached);
        runFs(source.list(dir))
          .then((listing) => {
            if (listing._tag === "Found") show(dir, listing.entries);
          })
          .catch((error: unknown) => console.error(`[explorer] refreshing ${dir} failed`, error));
        return;
      }
      setState((prev) => {
        if (prev.loading.has(dir)) return prev;
        const loading = new Set(prev.loading);
        loading.add(dir);
        const failed = new Set(prev.failed);
        failed.delete(dir);
        return { ...prev, loading, failed };
      });
      runFs(source.list(dir))
        .then((listing) => {
          if (listing._tag === "Found") {
            show(dir, listing.entries);
            return;
          }
          if (dir === root) setRootError("This folder isn’t here.");
          markFailed(dir);
        })
        .catch((error: unknown) => {
          if (dir === root) setRootError(reasonOf(error));
          markFailed(dir);
        });
    },
    [source, root, show, markFailed],
  );

  // Seed from the cache and refresh when the root (or the source) changes.
  React.useEffect(() => {
    setState(seed(source, root));
    setRootError(undefined);
    load(root);
  }, [source, root, load]);

  const toggle = React.useCallback(
    (row: SourceRow): void => {
      if (row.kind !== "directory") return;
      setState((prev) => {
        const expanded = new Set(prev.expanded);
        if (expanded.has(row.path)) expanded.delete(row.path);
        else expanded.add(row.path);
        return { ...prev, expanded };
      });
      // Load its children the first time it opens (outside the updater, so the work is not tied to a render).
      if (!state.expanded.has(row.path) && !state.children.has(row.path)) load(row.path);
    },
    [load, state.children, state.expanded],
  );

  const rows = React.useMemo(() => flattenRows(state, root), [state, root]);

  return {
    rows,
    rootLoading: state.loading.has(root) && !state.children.has(root),
    rootFailed: state.failed.has(root),
    rootError,
    toggle,
    reload: () => {
      setRootError(undefined);
      load(root);
      state.expanded.forEach((dir) => load(dir));
    },
  };
};
