/**
 * The file light's flash queue: the dot beside a file's name in Files' pill.
 *
 * It flashes a colour — **blue for a local (device) save, green for a cloud
 * (disk) save, purple when a change from outside lands** (an agent's). To avoid flicker, a flash lasts at least
 * `FLASH_MS` and only one plays at a time: if a local and a cloud save land
 * together, one flashes, then the other (it waits its turn). Rapid repeats of a
 * colour already showing or already queued are coalesced, so a burst of saves
 * never builds a backlog — at most one local and one cloud flash wait.
 *
 * Dedupe is by **consecutive colour, in the queue only**: a flash is dropped
 * only when the light is busy *and* it repeats whatever is at the tail (the
 * current flash, or the last queued one). So a same-colour flash is dropped when
 * it would queue back-to-back (no visible change), but once the light is at rest
 * the same colour may flash again — two in a row is fine when it isn't queued.
 *
 * The queue transitions here are pure (tested); `flashFile` drives them with a
 * timer per file.
 *
 * @internal
 */
import * as React from "react";

export type SaveFlash = "local" | "cloud" | "incoming";

/** Blue = saved on device (local), green = saved to disk (cloud), purple = a
 * change came in from outside. Prototype colours — tweak freely. */
export const FLASH_COLOR: Readonly<Record<SaveFlash, string>> = {
  local: "#0a84ff",
  cloud: "#32d74b",
  incoming: "#bf5af2",
};

/** The minimum a flash shows (and so the fastest two can follow each other). */
export const FLASH_MS = 320;

export interface SaveLightState {
  /** The colour showing now, or null when the light is at rest. */
  readonly current: SaveFlash | null;
  /** Flashes waiting their turn, in order (consecutive repeats dropped). */
  readonly pending: ReadonlyArray<SaveFlash>;
}

export const initialSaveLight: SaveLightState = { current: null, pending: [] };

/** Add a flash. Idle → it shows at once (even the same colour as the last one —
 * two in a row is fine when not queued). Busy → it waits, unless it would just
 * repeat the colour already at the tail (current, or the last queued), in which
 * case it's dropped — consecutive-colour dedupe within the queue. */
export const enqueueFlash = (state: SaveLightState, kind: SaveFlash): SaveLightState => {
  if (state.current === null) return { current: kind, pending: [] };
  const tail = state.pending.length > 0 ? state.pending[state.pending.length - 1] : state.current;
  if (tail === kind) return state;
  return { current: state.current, pending: [...state.pending, kind] };
};

/** The current flash finished: show the next waiting one, or go to rest. */
export const advanceFlash = (state: SaveLightState): SaveLightState => {
  const [next, ...rest] = state.pending;
  return next === undefined ? { current: null, pending: [] } : { current: next, pending: rest };
};

// Each file's light, kept outside any view: the open file flashes it, and
// Files' pill shows it beside the file's name.
const lights = new Map<string, SaveLightState>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((listener) => listener());

const lightOf = (path: string): SaveLightState => lights.get(path) ?? initialSaveLight;

const store = (path: string, state: SaveLightState): void => {
  if (state.current === null) lights.delete(path);
  else lights.set(path, state);
  notify();
};

/** Hold the showing flash for `FLASH_MS`, then show the next or rest. */
const schedule = (path: string): void => {
  if (timers.has(path) || lightOf(path).current === null) return;
  timers.set(
    path,
    setTimeout(() => {
      timers.delete(path);
      store(path, advanceFlash(lightOf(path)));
      schedule(path);
    }, FLASH_MS),
  );
};

/** Flash a file's light. */
export const flashFile = (path: string, kind: SaveFlash): void => {
  store(path, enqueueFlash(lightOf(path), kind));
  schedule(path);
};

/** The colour a file's light shows now, for React (null at rest). */
export const useFileLight = (path: string): SaveFlash | null =>
  React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => lightOf(path).current,
  );
