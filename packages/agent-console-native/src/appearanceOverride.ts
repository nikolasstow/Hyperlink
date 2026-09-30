/**
 * The app's light/dark look, forced to follow the background's lightness when
 * it disagrees with iOS: a dark background colour chosen for light mode renders
 * the app dark (white text), and a light one chosen for dark mode renders it
 * light. Text, native controls and glass all follow, since they are iOS's own
 * colours resolved by the look.
 *
 * Which background is in use still depends on iOS's actual mode, so it is kept
 * here: read while nothing is forced (Appearance reports it then), and re-read
 * each time the app comes to the foreground (iOS may have switched while the
 * app forced its own look), by clearing the force for a moment.
 *
 * @internal
 */
import * as React from "react";
import { AppState, Appearance } from "react-native";

export type Scheme = "light" | "dark";

const asScheme = (value: unknown): Scheme => (value === "dark" ? "dark" : "light");

let systemScheme: Scheme = asScheme(Appearance.getColorScheme());
let forced: Scheme | undefined;
const listeners = new Set<() => void>();

const setSystem = (next: Scheme): void => {
  if (systemScheme === next) return;
  systemScheme = next;
  listeners.forEach((listener) => listener());
};

// While nothing is forced, Appearance reports iOS's mode as it changes.
Appearance.addChangeListener(({ colorScheme }) => {
  if (forced === undefined) setSystem(asScheme(colorScheme));
});

// Coming back to the foreground: clear the force to read iOS's mode, then
// force again (whoever forces recomputes if the mode changed).
AppState.addEventListener("change", (state) => {
  if (state !== "active" || forced === undefined) return;
  const keep = forced;
  Appearance.setColorScheme("unspecified");
  setSystem(asScheme(Appearance.getColorScheme()));
  Appearance.setColorScheme(keep);
});

/** Force the app's look, or (undefined) let it follow iOS. */
export const forceScheme = (next: Scheme | undefined): void => {
  if (forced === next) return;
  forced = next;
  Appearance.setColorScheme(next ?? "unspecified");
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** iOS's actual light/dark mode, whatever the app is forcing: which of the
 * theme's backgrounds (light or dark) is in use. */
export const useSystemScheme = (): Scheme => React.useSyncExternalStore(subscribe, () => systemScheme);
