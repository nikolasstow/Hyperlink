/**
 * Whether autosave (the debounced write to disk) is on for a given file —
 * settable per **scope**: a file, a folder (any ancestor), a repo/workspace, a
 * server, or the whole app. The **nearest** scope with an explicit setting wins;
 * with none set, autosave is on (app-wide default).
 *
 * An in-memory map (synchronous, for the save path) backed by AsyncStorage,
 * reactive for the UI. See docs/handoffs/native-ide.md.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as React from "react";

const KEY_PREFIX = "autosave:v1:";

/** A scope an autosave setting can be attached to. */
export type AutosaveScope =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "folder"; readonly path: string }
  | { readonly kind: "repo"; readonly repo: string }
  | { readonly kind: "server"; readonly id: string }
  | { readonly kind: "app" };

/** The context a file lives in, for resolution. */
export interface FileScopeContext {
  readonly path: string;
  readonly repo?: string;
  readonly server?: string;
}

/** On by default (app-wide), unless a nearer scope says otherwise. */
export const AUTOSAVE_DEFAULT = true;

export const scopeKey = (scope: AutosaveScope): string => {
  switch (scope.kind) {
    case "file":
      return `file:${scope.path}`;
    case "folder":
      return `folder:${scope.path}`;
    case "repo":
      return `repo:${scope.repo}`;
    case "server":
      return `server:${scope.id}`;
    case "app":
      return "app";
  }
};

/** The folders between a file and the filesystem root, longest (nearest) first. */
const ancestorFolders = (path: string): ReadonlyArray<string> => {
  const out: Array<string> = [];
  let dir = path.slice(0, path.lastIndexOf("/"));
  while (dir.length > 0) {
    out.push(dir);
    const next = dir.slice(0, dir.lastIndexOf("/"));
    if (next === dir) break;
    dir = next;
  }
  return out;
};

/** The scope keys that could govern a file, from nearest to farthest. */
export const resolutionOrder = (ctx: FileScopeContext): ReadonlyArray<string> => {
  const keys: Array<string> = [`file:${ctx.path}`];
  for (const folder of ancestorFolders(ctx.path)) keys.push(`folder:${folder}`);
  if (ctx.repo !== undefined) keys.push(`repo:${ctx.repo}`);
  if (ctx.server !== undefined) keys.push(`server:${ctx.server}`);
  keys.push("app");
  return keys;
};

/** Resolve autosave for a file: the nearest scope with an explicit setting, else
 * the app-wide default. */
export const resolveAutosave = (settings: ReadonlyMap<string, boolean>, ctx: FileScopeContext): boolean => {
  for (const key of resolutionOrder(ctx)) {
    const value = settings.get(key);
    if (value !== undefined) return value;
  }
  return AUTOSAVE_DEFAULT;
};

// --- Store (memory + AsyncStorage), reactive. ---

const settings = new Map<string, boolean>();
let snap: ReadonlyMap<string, boolean> = new Map();
const listeners = new Set<() => void>();
const notify = (): void => {
  snap = new Map(settings);
  listeners.forEach((listener) => listener());
};

/** The current settings, synchronously (for the save path). */
export const autosaveSettingsNow = (): ReadonlyMap<string, boolean> => snap;

/** The settings, for React. */
export const useAutosaveSettings = (): ReadonlyMap<string, boolean> =>
  React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snap,
  );

/** Set (or clear, with undefined) a scope's autosave. */
export const setAutosave = (scope: AutosaveScope, on: boolean | undefined): void => {
  const key = scopeKey(scope);
  if (on === undefined) {
    settings.delete(key);
    void AsyncStorage.removeItem(`${KEY_PREFIX}${key}`).catch(() => undefined);
  } else {
    settings.set(key, on);
    void AsyncStorage.setItem(`${KEY_PREFIX}${key}`, on ? "1" : "0").catch(() => undefined);
  }
  notify();
};

/** Read back the saved settings at launch. */
export const loadAutosaveSettings = async (): Promise<void> => {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((key) => key.startsWith(KEY_PREFIX));
    const pairs = await AsyncStorage.multiGet(mine);
    for (const [key, value] of pairs) {
      if (value === null) continue;
      settings.set(key.slice(KEY_PREFIX.length), value === "1");
    }
    notify();
  } catch {
    // Best-effort — falls back to the app-wide default.
  }
};
