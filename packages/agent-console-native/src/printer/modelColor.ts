/**
 * The colour the 3D model shows in: one for every model, the owner's
 * choice, kept on the phone. Until the owner picks one, it follows the
 * theme (the primary colour, made pale). Resin swatches give a quick start.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as React from "react";
import { towardWhiteHex } from "../theme";
import { usePalette } from "./ui";

const KEY = "agent-console-native:printer:modelColor";

/** Common resin colours, for one tap. */
export const RESIN_SWATCHES: ReadonlyArray<{ readonly name: string; readonly color: string }> = [
  { name: "Grey", color: "#9A9CA3" },
  { name: "White", color: "#ECECEA" },
  { name: "Black", color: "#2E2F33" },
  { name: "Clear", color: "#D9C7A0" },
  { name: "Beige", color: "#E3CFAF" },
  { name: "Green", color: "#7FBF7A" },
];

let chosen: string | undefined;
let loaded = false;
const listeners = new Set<() => void>();

const notify = (): void => listeners.forEach((listener) => listener());

const load = (): void => {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(KEY)
    .then((raw) => {
      if (raw !== null && /^#[0-9a-fA-F]{6}$/.test(raw)) {
        chosen = raw;
        notify();
      }
    })
    .catch((cause: unknown) => console.error("[printer] reading the model colour failed", cause));
};

/** Keeps the owner's colour, `#rrggbb`; undefined goes back to the theme's. */
export const setModelColor = (color: string | undefined): void => {
  chosen = color?.slice(0, 7).toUpperCase();
  notify();
  (chosen === undefined ? AsyncStorage.removeItem(KEY) : AsyncStorage.setItem(KEY, chosen)).catch((cause: unknown) =>
    console.error("[printer] keeping the model colour failed", cause),
  );
};

/** The model's colour, and whether the owner chose it (false: it follows the theme). */
export const useModelColor = (): { readonly color: string; readonly custom: boolean } => {
  const palette = usePalette();
  const [, setVersion] = React.useState(0);
  React.useEffect(() => {
    load();
    const listener = (): void => setVersion((version) => version + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return chosen === undefined ? { color: towardWhiteHex(palette.accent, 0.6), custom: false } : { color: chosen, custom: true };
};
