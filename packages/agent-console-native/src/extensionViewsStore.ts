/**
 * Extension views, prefetched and cached, so no screen waits on the host.
 *
 * Home prefetches every repo and worktree it knows (the host warms them and
 * this pulls their views and whole trees into memory). The repo menu and a
 * view's screen then render from here at once, and revalidate in the
 * background: `ifChanged` costs the host a few file stats when nothing moved.
 *
 * A failed load shows as a failure; a failed revalidation keeps the rows on
 * screen and carries its error beside them, so nothing is lost and nothing is
 * hidden.
 *
 * Each workspace's list of views is also kept on the device and read back at
 * launch, so the repo menu has its rows from its first frame (its height
 * known, nothing resizing) and only changes when the list does; the read-back
 * lists are revalidated as before.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Option, Schema } from "effect";
import * as React from "react";
import { listViews, viewInfo, viewTree, warmViews, type TreeEntry, type TreeRefresh, type ViewInfo } from "./extensionViewsClient";
import { prefetchPage } from "./pagesStore";

export type Load<A> =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly value: A;
      readonly refreshing: boolean;
      /** Why the last revalidation failed, while the older value is shown. */
      readonly error?: string;
    }
  | { readonly kind: "failed"; readonly message: string };

interface WorkspaceEntry {
  readonly views: Load<ReadonlyArray<ViewInfo>>;
  readonly trees: ReadonlyMap<string, Load<ReadonlyArray<TreeEntry>>>;
}

let state: ReadonlyMap<string, WorkspaceEntry> = new Map();
const listeners = new Set<() => void>();
/** Loads in flight, by key, so a second caller shares the first's request. */
const inflight = new Map<string, Promise<void>>();

const emit = (): void => listeners.forEach((listener) => listener());

const update = (workspace: string, change: (entry: WorkspaceEntry) => WorkspaceEntry): void => {
  const entry = state.get(workspace) ?? { views: { kind: "loading" }, trees: new Map() };
  state = new Map([...state, [workspace, change(entry)]]);
  emit();
};

// ── Kept on the device ──

const STORAGE_KEY = "agent-console-native:extensionViews";
const StoredViews = Schema.Record(Schema.String, Schema.Array(viewInfo));
/** Workspaces whose views were read back, not yet revalidated. */
const readBack = new Set<string>();

/** Keeps every workspace's ready list of views. */
const keepViews = (): void => {
  const lists = Object.fromEntries(
    [...state].flatMap(([workspace, entry]): ReadonlyArray<readonly [string, ReadonlyArray<ViewInfo>]> => (entry.views.kind === "ready" ? [[workspace, entry.views.value]] : [])),
  );
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(lists)).catch((error: unknown) => console.error("[extension views] keeping the views failed", error));
};

// Read back once, at launch: a workspace not loaded yet starts from its kept
// list (revalidated on its next ensure or prefetch).
AsyncStorage.getItem(STORAGE_KEY).then(
  (raw) => {
    if (raw === null) return;
    const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(StoredViews))(raw);
    if (Option.isNone(decoded)) {
      console.error("[extension views] the kept views could not be read; starting without them");
      return;
    }
    let changed = false;
    const next = new Map(state);
    for (const [workspace, views] of Object.entries(decoded.value)) {
      if (next.has(workspace)) continue;
      next.set(workspace, { views: { kind: "ready", value: views, refreshing: true }, trees: new Map() });
      readBack.add(workspace);
      changed = true;
    }
    if (changed) {
      state = next;
      emit();
    }
  },
  (error: unknown) => console.error("[extension views] reading the kept views failed", error),
);

/** Whether a workspace's views still need loading: never loaded, or only read
 * back from the device. */
const needsLoad = (workspace: string): boolean => !state.has(workspace) || readBack.has(workspace);

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const once = (key: string, run: () => Promise<void>): Promise<void> => {
  const running = inflight.get(key);
  if (running !== undefined) return running;
  const started = run().finally(() => inflight.delete(key));
  inflight.set(key, started);
  return started;
};

const setTree = (workspace: string, view: string, load: Load<ReadonlyArray<TreeEntry>>): void =>
  update(workspace, (entry) => ({ ...entry, trees: new Map([...entry.trees, [view, load]]) }));

/** Fetch a tree. With rows already cached, they stay on screen while it runs,
 * and a failure is attached to them instead of replacing them. */
const loadTree = (apiBase: string, workspace: string, view: string, refresh: TreeRefresh): Promise<void> =>
  once(`tree ${workspace} ${view} ${refresh}`, async () => {
    const current = state.get(workspace)?.trees.get(view);
    if (current?.kind === "ready") setTree(workspace, view, { ...current, refreshing: true });
    else setTree(workspace, view, { kind: "loading" });
    try {
      const rows = await viewTree(apiBase, workspace, view, refresh);
      setTree(workspace, view, { kind: "ready", value: rows, refreshing: false });
    } catch (error: unknown) {
      const latest = state.get(workspace)?.trees.get(view);
      setTree(
        workspace,
        view,
        latest?.kind === "ready" ? { kind: "ready", value: latest.value, refreshing: false, error: messageOf(error) } : { kind: "failed", message: messageOf(error) },
      );
    }
  });

/** A workspace's views, then every view's tree or page. */
const loadWorkspace = (apiBase: string, workspace: string): Promise<void> =>
  once(`views ${workspace}`, async () => {
    try {
      readBack.delete(workspace);
      const views = await listViews(apiBase, workspace);
      update(workspace, (entry) => ({ ...entry, views: { kind: "ready", value: views, refreshing: false } }));
      keepViews();
      await Promise.all(views.map((view) => (view.kind === "tree" ? loadTree(apiBase, workspace, view.id, "none") : prefetchPage(apiBase, workspace, view.id, view.kind))));
    } catch (error: unknown) {
      // Rows on screen (kept, or from before) stay, the failure beside them.
      update(workspace, (entry) => ({
        ...entry,
        views: entry.views.kind === "ready" ? { ...entry.views, refreshing: false, error: messageOf(error) } : { kind: "failed", message: messageOf(error) },
      }));
    }
  });

/**
 * Warm these workspaces on the host and cache their views and trees. Called by
 * Home once it knows the repos. The host warm-up and the per-workspace loads
 * run together; a workspace that fails records its own failure.
 */
export const prefetchWorkspaces = (apiBase: string, workspaces: ReadonlyArray<string>): void => {
  const missing = workspaces.filter(needsLoad);
  if (missing.length === 0) return;
  // The warm-up only speeds things up; any workspace it cannot take fails its
  // own load below, which is where that shows.
  void warmViews(apiBase, missing).then(
    () => undefined,
    (error: unknown) => console.error("[extension views] warming the host failed", error),
  );
  missing.forEach((workspace) => void loadWorkspace(apiBase, workspace));
};

/** Load a workspace not seen before (a repo opened some other way). */
export const ensureWorkspace = (apiBase: string, workspace: string): void => {
  if (needsLoad(workspace)) void loadWorkspace(apiBase, workspace);
};

/** Retry a workspace whose views failed to load. */
export const reloadWorkspace = (apiBase: string, workspace: string): void => {
  inflight.delete(`views ${workspace}`);
  void loadWorkspace(apiBase, workspace);
};

/** Revalidate a tree in the background: `ifChanged` when a screen opens,
 * `force` for pull to refresh. */
export const revalidateTree = (apiBase: string, workspace: string, view: string, refresh: "ifChanged" | "force"): Promise<void> =>
  loadTree(apiBase, workspace, view, refresh);

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const loadingViews: Load<ReadonlyArray<ViewInfo>> = { kind: "loading" };
const loadingTree: Load<ReadonlyArray<TreeEntry>> = { kind: "loading" };

export const useWorkspaceViews = (workspace: string): Load<ReadonlyArray<ViewInfo>> =>
  React.useSyncExternalStore(subscribe, () => state.get(workspace)?.views ?? loadingViews);

export const useViewTree = (workspace: string, view: string): Load<ReadonlyArray<TreeEntry>> =>
  React.useSyncExternalStore(subscribe, () => state.get(workspace)?.trees.get(view) ?? loadingTree);
