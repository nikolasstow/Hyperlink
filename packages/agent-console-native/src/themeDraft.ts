/**
 * The theme currently being edited, shared across the editor's screens.
 *
 * Editing one theme spans six pushed screens (the editor, a colour group, the
 * token list, one rule, the import source and its value tree), and every one of
 * them both reads and writes the same document. Navigation params carry values
 * *down* only, so the draft lives here instead: a module-level store read
 * through `useSyncExternalStore`, which is React's own answer for state outside
 * the tree and keeps every mounted screen on the same snapshot.
 *
 * The draft is deliberately not persisted. Saving is an explicit act on the
 * editor screen, so abandoning an edit leaves the stored theme untouched.
 *
 * @internal
 */
import * as React from "react";
import { EMPTY_THEME, type VsCodeTheme } from "./vscodeTheme";

/**
 * A draft is either open on a theme or absent. Modelling it as a union rather
 * than a theme plus an `isOpen` flag means a screen cannot read a stale
 * document from a closed draft.
 */
export type ThemeDraft =
  | { readonly kind: "closed" }
  | {
      readonly kind: "open";
      /** The id being edited, or undefined while creating a theme that has never been saved. */
      readonly id: string | undefined;
      readonly theme: VsCodeTheme;
      /** What the draft looked like when it opened, for change detection and revert. */
      readonly original: VsCodeTheme;
      /** Paths written by the most recent import, so the editor can badge them. */
      readonly imported: ReadonlySet<string>;
      /** View-only: an installed extension theme opened to inspect, never edit.
       * Every editing control keys off this, and writes are refused below. */
      readonly readonly: boolean;
    };

const CLOSED: ThemeDraft = { kind: "closed" };

let current: ThemeDraft = CLOSED;
const listeners = new Set<() => void>();

const emit = (next: ThemeDraft): void => {
  current = next;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const snapshot = (): ThemeDraft => current;

/** The live draft. Every screen in the editor reads through this. */
export const useThemeDraft = (): ThemeDraft => React.useSyncExternalStore(subscribe, snapshot, snapshot);

/**
 * Starts editing. `id` is undefined for a brand-new theme; `theme` is the
 * prefill, which for a new theme is the values of whatever theme is currently
 * applied. `readonly` opens the theme for inspection only — an installed
 * extension theme, which the store owns and this app cannot rewrite.
 */
export const openDraft = (id: string | undefined, theme: VsCodeTheme, readonly = false): void => {
  emit({
    kind: "open",
    id,
    theme,
    original: theme,
    imported: new Set(),
    readonly,
  });
};

export const closeDraft = (): void => emit(CLOSED);

/** Applies an edit. A closed draft ignores writes rather than resurrecting
 * itself, and a read-only draft refuses them so a view-only theme can never be
 * mutated by a stray control. */
export const updateDraft = (change: (theme: VsCodeTheme) => VsCodeTheme): void => {
  if (current.kind !== "open" || current.readonly) return;
  emit({ ...current, theme: change(current.theme) });
};

/** Records which paths an import wrote, so the editor can show what came from where. */
export const markImported = (paths: ReadonlySet<string>, theme: VsCodeTheme): void => {
  if (current.kind !== "open") return;
  emit({
    ...current,
    theme,
    imported: new Set([...current.imported, ...paths]),
  });
};

/** Notes the id a newly saved theme was given, so a second save updates rather than duplicates. */
export const adoptSavedId = (id: string): void => {
  if (current.kind !== "open") return;
  emit({ ...current, id });
};

/** Convenience for screens that only make sense with a draft open. */
export const draftTheme = (draft: ThemeDraft): VsCodeTheme => (draft.kind === "open" ? draft.theme : EMPTY_THEME);
