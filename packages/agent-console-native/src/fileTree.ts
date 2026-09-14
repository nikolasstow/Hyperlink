/**
 * Lazy, expandable file tree for the explorer — the data behind the iOS
 * Files-style outline. Directories load their children on first expand (via the
 * backend `/fs/list`, run through `runFs`), and the expanded set is flattened
 * into a depth-tagged row list a `FlatList` renders. Collapsing keeps loaded
 * children cached, so re-expanding is instant.
 *
 * IO is our own backend (fsClient), never opencode; a failed load marks that
 * directory failed (surfaced in the row as a retry) rather than silently
 * dropping it.
 *
 * @internal
 */
import * as React from "react";
import { runFs } from "./effect/runtime";
import { fsList } from "./fsClient";

export type FileRow = {
  readonly path: string;
  readonly name: string;
  readonly type: "file" | "directory";
  /** Nesting depth for indentation; root entries are 0. */
  readonly depth: number;
  readonly expanded: boolean;
  readonly loading: boolean;
  readonly failed: boolean;
};

const joinPath = (parent: string, name: string): string => `${parent.replace(/\/+$/, "")}/${name}`;

type TreeState = {
  readonly children: ReadonlyMap<string, ReadonlyArray<{ readonly name: string; readonly type: "file" | "directory" }>>;
  readonly expanded: ReadonlySet<string>;
  readonly loading: ReadonlySet<string>;
  readonly failed: ReadonlySet<string>;
};

const EMPTY: TreeState = {
  children: new Map(),
  expanded: new Set(),
  loading: new Set(),
  failed: new Set(),
};

export type FileTree = {
  readonly rows: ReadonlyArray<FileRow>;
  readonly rootLoading: boolean;
  readonly rootFailed: boolean;
  readonly toggle: (row: FileRow) => void;
  readonly reloadRoot: () => void;
};

export const useFileTree = (backend: string, rootDir: string): FileTree => {
  const [state, setState] = React.useState<TreeState>(EMPTY);

  const load = React.useCallback(
    (dir: string): void => {
      setState((prev) => {
        if (prev.loading.has(dir)) return prev;
        const loading = new Set(prev.loading);
        loading.add(dir);
        const failed = new Set(prev.failed);
        failed.delete(dir);
        return { ...prev, loading, failed };
      });
      void runFs(fsList(backend, dir))
        .then((entries) => {
          setState((prev) => {
            const children = new Map(prev.children);
            children.set(dir, entries.map((entry) => ({ name: entry.name, type: entry.type })));
            const loading = new Set(prev.loading);
            loading.delete(dir);
            return { ...prev, children, loading };
          });
        })
        .catch(() => {
          setState((prev) => {
            const loading = new Set(prev.loading);
            loading.delete(dir);
            const failed = new Set(prev.failed);
            failed.add(dir);
            // Collapse it back so it shows a retry affordance rather than an
            // open-but-empty node; the next tap re-expands and reloads.
            const expanded = new Set(prev.expanded);
            expanded.delete(dir);
            return { ...prev, loading, failed, expanded };
          });
        });
    },
    [backend],
  );

  // Load the root on mount / when the rooted directory changes.
  React.useEffect(() => {
    setState(EMPTY);
    load(rootDir);
  }, [rootDir, load]);

  const toggle = React.useCallback(
    (row: FileRow): void => {
      if (row.type !== "directory") return;
      setState((prev) => {
        const expanded = new Set(prev.expanded);
        if (expanded.has(row.path)) {
          expanded.delete(row.path);
          return { ...prev, expanded };
        }
        expanded.add(row.path);
        return { ...prev, expanded };
      });
      // Fetch children the first time it opens (outside the state updater so the
      // async work isn't tied to a render).
      if (!state.expanded.has(row.path) && !state.children.has(row.path)) load(row.path);
    },
    [load, state.children, state.expanded],
  );

  const rows = React.useMemo<ReadonlyArray<FileRow>>(() => {
    const walk = (dir: string, depth: number): ReadonlyArray<FileRow> => {
      const entries = state.children.get(dir) ?? [];
      return entries.flatMap((entry) => {
        const path = joinPath(dir, entry.name);
        const expanded = state.expanded.has(path);
        const row: FileRow = {
          path,
          name: entry.name,
          type: entry.type,
          depth,
          expanded,
          loading: state.loading.has(path),
          failed: state.failed.has(path),
        };
        if (entry.type === "directory" && expanded) return [row, ...walk(path, depth + 1)];
        return [row];
      });
    };
    return walk(rootDir, 0);
  }, [state, rootDir]);

  return {
    rows,
    rootLoading: state.loading.has(rootDir) && !state.children.has(rootDir),
    rootFailed: state.failed.has(rootDir),
    toggle,
    reloadRoot: () => load(rootDir),
  };
};
