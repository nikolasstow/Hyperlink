/**
 * How Files shows a path: from the repo's (or folder's) root, as
 * "hyperlink/src/files" (the default), or in full, as
 * "/Users/me/Coding/hyperlink/src/files". A setting (Settings → Files),
 * remembered on this device.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as React from "react";

const storageKey = "filesFullPaths";

let full = false;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// Read once; until it arrives, paths are shown from the root.
AsyncStorage.getItem(storageKey).then(
  (saved) => {
    if (saved === "true") {
      full = true;
      emit();
    }
  },
  (error: unknown) => console.error("[files] reading the path setting failed", error),
);

export const setFullPaths = (next: boolean): void => {
  if (next === full) return;
  full = next;
  emit();
  AsyncStorage.setItem(storageKey, String(next)).catch((error: unknown) => console.error("[files] saving the path setting failed", error));
};

export const useFullPaths = (): boolean => React.useSyncExternalStore(subscribe, () => full);

/** A path as the setting shows it: in full, or from the root (the root's own
 * name first). A path outside the root is shown in full. */
export const shownPath = (path: string, root: string, fullPaths: boolean): string => {
  const base = root.replace(/\/+$/, "");
  if (fullPaths || !(path === base || path.startsWith(`${base}/`))) return path;
  const rootName = base.split("/").filter(Boolean).pop() ?? base;
  return `${rootName}${path.slice(base.length)}`;
};

/** Whether a path is the root itself (its folder is outside it: nothing to
 * show under its name). */
export const isRootPath = (path: string, root: string): boolean => path.replace(/\/+$/, "") === root.replace(/\/+$/, "");
