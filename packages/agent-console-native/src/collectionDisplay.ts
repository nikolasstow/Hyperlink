/**
 * How a collection page is shown, list (the tree view) or grid, remembered per
 * page on this device and shared by every screen of that page, so switching
 * it in one switches it everywhere.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as React from "react";

export type CollectionDisplay = "list" | "grid";

const storageKey = (page: string): string => `collectionDisplay:${page}`;

let modes: ReadonlyMap<string, CollectionDisplay> = new Map();
const listeners = new Set<() => void>();
const requested = new Set<string>();

const set = (page: string, mode: CollectionDisplay): void => {
  modes = new Map([...modes, [page, mode]]);
  listeners.forEach((listener) => listener());
};

/** Read the saved mode once per page. A read that fails leaves the default
 * (list) and says why in the log; it is a display preference, nothing more. */
const ensureLoaded = (page: string): void => {
  if (requested.has(page)) return;
  requested.add(page);
  AsyncStorage.getItem(storageKey(page)).then(
    (saved) => {
      if (saved === "grid" || saved === "list") set(page, saved);
    },
    (error: unknown) => console.error(`[collection display] reading the saved mode for ${page} failed`, error),
  );
};

export const setCollectionDisplay = (page: string, mode: CollectionDisplay): void => {
  set(page, mode);
  AsyncStorage.setItem(storageKey(page), mode).catch((error: unknown) => console.error(`[collection display] saving the mode for ${page} failed`, error));
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useCollectionDisplay = (page: string): CollectionDisplay => {
  React.useEffect(() => ensureLoaded(page), [page]);
  return React.useSyncExternalStore(subscribe, () => modes.get(page) ?? "list");
};
