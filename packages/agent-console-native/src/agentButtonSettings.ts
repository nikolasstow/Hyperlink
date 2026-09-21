/**
 * Visibility settings for the app-wide assistant (Dubz) button: one global
 * on/off, plus a per-surface toggle for each place the button can appear. Lives
 * in a small module store (read live via `useSyncExternalStore`) backed by
 * AsyncStorage — the same shape `sessionPermissions` uses — so a change on the
 * settings screen reflects immediately wherever the button renders.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as React from "react";

/** The surfaces the assistant button can be shown on. */
export type AgentSurface = "home" | "repo" | "session" | "editor";

export const AGENT_SURFACES: ReadonlyArray<{ readonly key: AgentSurface; readonly label: string }> = [
  { key: "home", label: "Home" },
  { key: "repo", label: "Repos & projects" },
  { key: "session", label: "Sessions" },
  { key: "editor", label: "File, doc & rule editors" },
];

export interface AgentButtonSettings {
  /** The master switch — off hides the button everywhere regardless of surfaces. */
  readonly enabled: boolean;
  /** Per-surface visibility, applied only when `enabled`. */
  readonly surfaces: Record<AgentSurface, boolean>;
}

const DEFAULT: AgentButtonSettings = {
  enabled: true,
  surfaces: { home: true, repo: true, session: true, editor: true },
};

const STORAGE_KEY = "agent-console-native:agentButton";

const asBool = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

const isSurface = (key: string): key is AgentSurface =>
  key === "home" || key === "repo" || key === "session" || key === "editor";

const parse = (value: unknown): AgentButtonSettings => {
  if (typeof value !== "object" || value === null) return DEFAULT;
  const surfaces: Record<AgentSurface, boolean> = { home: true, repo: true, session: true, editor: true };
  if ("surfaces" in value && typeof value.surfaces === "object" && value.surfaces !== null) {
    // Object.entries over an unknown record yields `any` values (not a cast),
    // narrowed per-entry — so no `as` needed to read the stored shape.
    for (const [key, raw] of Object.entries(value.surfaces)) {
      if (isSurface(key) && typeof raw === "boolean") surfaces[key] = raw;
    }
  }
  return {
    enabled: "enabled" in value ? asBool(value.enabled, true) : true,
    surfaces,
  };
};

let current: AgentButtonSettings = DEFAULT;
const listeners = new Set<() => void>();

const emit = (next: AgentButtonSettings): void => {
  current = next;
  for (const listener of listeners) listener();
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
};

// Load the stored value once at module init. Until it resolves the defaults
// (all on) apply — a preference read, so a brief default is harmless.
void AsyncStorage.getItem(STORAGE_KEY)
  .then((raw) => {
    if (raw === null) return;
    try {
      const next = parse(JSON.parse(raw));
      current = next;
      for (const listener of listeners) listener();
    } catch {
      // keep defaults on unparseable storage
    }
  })
  .catch(() => undefined);

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const snapshot = (): AgentButtonSettings => current;

export const useAgentButtonSettings = (): AgentButtonSettings =>
  React.useSyncExternalStore(subscribe, snapshot, snapshot);

/** Whether the assistant button should render on `surface`. */
export const useAgentButtonVisible = (surface: AgentSurface): boolean => {
  const settings = useAgentButtonSettings();
  return settings.enabled && settings.surfaces[surface];
};

export const setAgentButtonEnabled = (enabled: boolean): void => emit({ ...current, enabled });

export const setAgentSurfaceEnabled = (surface: AgentSurface, on: boolean): void =>
  emit({ ...current, surfaces: { ...current.surfaces, [surface]: on } });
