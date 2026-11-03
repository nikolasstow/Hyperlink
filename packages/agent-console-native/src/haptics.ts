/**
 * A subtle haptic for an event the person should feel but not be startled by
 * (a reply arrived). `Vibration.vibrate()` on iOS has one setting, the full
 * heavy buzz; `expo-haptics` gives the soft taps the system itself uses.
 *
 * Loaded with `require`, guarded: expo-haptics is a native module that may
 * not be in the current binary yet. When it isn't, there is no feedback at
 * all — deliberately, since the heavy vibration is what this replaces.
 *
 * @internal
 */

declare const require: (moduleName: string) => unknown;

type ImpactStyle = "light" | "medium" | "heavy" | "soft" | "rigid";

type HapticsApi = {
  readonly impactAsync: (style: ImpactStyle) => Promise<void>;
};

const isHapticsApi = (value: unknown): value is HapticsApi =>
  typeof value === "object" && value !== null && "impactAsync" in value && typeof value.impactAsync === "function";

let haptics: HapticsApi | undefined;
let tried = false;

const load = (): HapticsApi | undefined => {
  if (tried) return haptics;
  tried = true;
  try {
    const loaded = require("expo-haptics");
    if (isHapticsApi(loaded)) haptics = loaded;
  } catch {
    // Not in this build; silent until the next one.
  }
  return haptics;
};

/** A light tap: a reply finished. */
export const tapLight = (): void => {
  const api = load();
  if (api === undefined) return;
  void api.impactAsync("light").catch(() => undefined);
};
