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
import { fromHome, under } from "./pathForms";

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

/** A path as the setting shows it: in full, or from its root (the root's own
 * name first). Its root is whichever of `roots` (Files' root, the repo's other
 * worktrees) holds it most closely; a path outside them all is shown in
 * full. */
export const shownPath = (path: string, roots: ReadonlyArray<string>, fullPaths: boolean): string => {
  if (fullPaths) return path;
  const closest = roots
    .flatMap((root) => {
      const rest = under(path, root);
      return rest === undefined ? [] : [{ root: fromHome(root), rest }];
    })
    .sort((a, b) => b.root.length - a.root.length)[0];
  if (closest === undefined) return path;
  const rootName = closest.root.split("/").filter(Boolean).pop() ?? closest.root;
  return `${rootName}${closest.rest}`;
};

/** Whether a path is the root itself (its folder is outside it: nothing to
 * show under its name). */
export const isRootPath = (path: string, root: string): boolean => under(path, root) === "";
