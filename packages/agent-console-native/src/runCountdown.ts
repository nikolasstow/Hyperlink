/**
 * Running a script waits out a short countdown first, so a stray tap does not
 * start one: the play button becomes a filling ring with a stop button, and
 * the script runs when the ring completes, unless stopped. How long it counts
 * is a setting (Settings → Scripts), remembered on this device.
 *
 * `useRunCountdown` is the one countdown a screen runs at a time: starting
 * another cancels the first.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as React from "react";

/** The lengths offered, the slider's stops (evenly spaced on it, so the
 * short ones do not crowd its start); the default is 3. */
export const RUN_DELAY_STOPS: ReadonlyArray<number> = [1, 2, 3, 5, 10, 15, 30];
const defaultSeconds = 3;

const isLength = (value: number): boolean => RUN_DELAY_STOPS.includes(value);
const storageKey = "runCountdownSeconds";
/** Whether scripts count down at all (on by default); off, a tap runs one at
 * once. */
const enabledKey = "runCountdownOn";

let seconds = defaultSeconds;
let enabled = true;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((listener) => listener());

// Read the saved length once; until it arrives, the default counts.
AsyncStorage.getItem(storageKey).then(
  (saved) => {
    const parsed = saved === null ? undefined : Number(saved);
    if (parsed !== undefined && isLength(parsed)) {
      seconds = parsed;
      emit();
    }
  },
  (error: unknown) => console.error("[run countdown] reading the saved length failed", error),
);

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

AsyncStorage.getItem(enabledKey).then(
  (saved) => {
    if (saved === "false") {
      enabled = false;
      emit();
    }
  },
  (error: unknown) => console.error("[run countdown] reading whether it is on failed", error),
);

export const setRunCountdownEnabled = (next: boolean): void => {
  if (next === enabled) return;
  enabled = next;
  emit();
  AsyncStorage.setItem(enabledKey, String(next)).catch((error: unknown) => console.error("[run countdown] saving whether it is on failed", error));
};

export const useRunCountdownEnabled = (): boolean => React.useSyncExternalStore(subscribe, () => enabled);

export const setRunCountdownSeconds = (next: number): void => {
  if (next === seconds || !isLength(next)) return;
  seconds = next;
  emit();
  AsyncStorage.setItem(storageKey, String(next)).catch((error: unknown) => console.error("[run countdown] saving the length failed", error));
};

export const useRunCountdownSeconds = (): number => React.useSyncExternalStore(subscribe, () => seconds);

/** The countdown in progress: which item, and how long it counts. */
export interface Countdown {
  readonly key: string;
  readonly durationMs: number;
}

/**
 * One countdown at a time for a screen. `start` counts down for `key`, then
 * calls `run`; `cancel` stops it. Starting another cancels the first; leaving
 * the screen cancels it too.
 */
export const useRunCountdown = (): {
  readonly counting: Countdown | undefined;
  readonly start: (key: string, run: () => void) => void;
  readonly cancel: () => void;
} => {
  const durationMs = useRunCountdownSeconds() * 1000;
  const on = useRunCountdownEnabled();
  const [counting, setCounting] = React.useState<Countdown | undefined>(undefined);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancel = React.useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
    setCounting(undefined);
  }, []);

  const start = React.useCallback(
    (key: string, run: () => void) => {
      if (timer.current !== undefined) clearTimeout(timer.current);
      // The countdown is off: run at once.
      if (!on) {
        timer.current = undefined;
        setCounting(undefined);
        run();
        return;
      }
      setCounting({
        key,
        durationMs,
      });
      timer.current = setTimeout(() => {
        timer.current = undefined;
        setCounting(undefined);
        run();
      }, durationMs);
    },
    [durationMs, on],
  );

  React.useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    },
    [],
  );

  return {
    counting,
    start,
    cancel,
  };
};
