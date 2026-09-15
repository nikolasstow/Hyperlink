/**
 * Lazy, expandable file tree for the explorer — the data behind the iOS
 * Files-style outline. Directories load their children on first expand (via the
 * backend `/fs/list`, run through `runFs`), and the expanded set is flattened
 * into a depth-tagged row list a `FlatList` renders. Collapsing keeps loaded
 * children cached, so re-expanding is instant.
 *
 * Listings are cache-first (fileListingCache): a directory already fetched — by
 * a previous visit, an earlier expand, or the one-level-ahead prefetch — paints
 * instantly with no spinner, then refreshes in the background. When a directory
 * loads, its immediate subdirectories are prefetched, so opening one is instant
 * without loading the whole tree up front.
 *
 * IO is our own backend (fsClient), never opencode; a failed load marks that
 * directory failed (surfaced in the row as a retry) rather than silently
 * dropping it.
 *
 * @internal
 */
import * as React from "react";
import { getCachedListing, loadTree } from "./fileListingCache";
import type { FsEntry } from "./fsClient";

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

/** Initial tree state for a root directory: its cached listing if we already
 * have one (so a revisited/prefetched folder paints with no spinner), else empty. */
const seedFromCache = (dir: string): TreeState => {
  const cached = getCachedListing(dir);
  if (cached === undefined) return EMPTY;
  return {
    children: new Map([[dir, cached.map((entry) => ({ name: entry.name, type: entry.type }))]]),
    expanded: new Set(),
    loading: new Set(),
    failed: new Set(),
  };
};

export type FileTree = {
  readonly rows: ReadonlyArray<FileRow>;
  readonly rootLoading: boolean;
  readonly rootFailed: boolean;
  /** A short reason for a root load failure, for display (transport/http/decode). */
  readonly rootError: string | undefined;
  readonly toggle: (row: FileRow) => void;
  readonly reloadRoot: () => void;
};

/** A short, displayable reason from a rejected load (an FsError value, or any thrown thing). */
const describeError = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "reason" in error) {
    const reason = String(error.reason);
    const status = "status" in error ? error.status : undefined;
    return status === undefined ? reason : `${reason} ${String(status)}`;
  }
  return String(error);
};

export const useFileTree = (backend: string, rootDir: string): FileTree => {
  const [state, setState] = React.useState<TreeState>(() => seedFromCache(rootDir));
  const [rootError, setRootError] = React.useState<string | undefined>(undefined);

  const showChildren = React.useCallback((dir: string, entries: ReadonlyArray<FsEntry>): void => {
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
      // Collapse it back so it shows a retry affordance rather than an
      // open-but-empty node; the next tap re-expands and reloads.
      const expanded = new Set(prev.expanded);
      expanded.delete(dir);
      return { ...prev, loading, failed, expanded };
    });
  }, []);

  const load = React.useCallback(
    (dir: string): void => {
      const cached = getCachedListing(dir);
      if (cached !== undefined) {
        // Paint from cache immediately (no spinner), then refresh the subtree in
        // the background — the session delta returns only what changed, so this
        // is cheap and a failure leaves the cache in place.
        showChildren(dir, cached);
        void loadTree(backend, dir)
          .then(() => {
            const fresh = getCachedListing(dir);
            if (fresh !== undefined) showChildren(dir, fresh);
          })
          .catch(() => undefined);
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
      // The bundle warms `dir` and its hot subtree at once, so expanding or
      // drilling into those is instant off the cache with no further request.
      void loadTree(backend, dir)
        .then(() => {
          const fresh = getCachedListing(dir);
          if (fresh !== undefined) showChildren(dir, fresh);
          else markFailed(dir);
        })
        .catch((error: unknown) => {
          if (dir === rootDir) setRootError(describeError(error));
          markFailed(dir);
        });
    },
    [backend, rootDir, showChildren, markFailed],
  );

  // Seed from cache and refresh on mount / when the rooted directory changes.
  React.useEffect(() => {
    setState(seedFromCache(rootDir));
    setRootError(undefined);
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
    rootError,
    toggle,
    reloadRoot: () => {
      setRootError(undefined);
      load(rootDir);
    },
  };
};
