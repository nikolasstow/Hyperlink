/**
 * The installed plugins, prefetched and cached, so the plugin manager never
 * shows a loading state on the way in. Home prefetches; the manager and a
 * plugin's details render from here at once and refresh in the background. A
 * failed refresh keeps the list on screen with its error beside it.
 *
 * @internal
 */
import * as React from "react";
import { listPlugins, type InstalledPlugin } from "./pluginsClient";

export type PluginsLoad =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly plugins: ReadonlyArray<InstalledPlugin>;
      /** Why the last refresh failed, while the older list is shown. */
      readonly error?: string;
    }
  | { readonly kind: "failed"; readonly message: string };

let state: PluginsLoad = { kind: "loading" };
const listeners = new Set<() => void>();
let inflight: Promise<void> | undefined;

const set = (next: PluginsLoad): void => {
  state = next;
  listeners.forEach((listener) => listener());
};

/** Load (or refresh) the installed plugins; concurrent callers share one request. */
export const refreshPlugins = (apiBase: string): Promise<void> => {
  if (inflight !== undefined) return inflight;
  inflight = listPlugins(apiBase)
    .then(
      (plugins) => set({ kind: "ready", plugins }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        set(state.kind === "ready" ? { kind: "ready", plugins: state.plugins, error: message } : { kind: "failed", message });
      },
    )
    .finally(() => {
      inflight = undefined;
    });
  return inflight;
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const usePlugins = (): PluginsLoad => React.useSyncExternalStore(subscribe, () => state);
