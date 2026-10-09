/**
 * The save indicator light's flash queue.
 *
 * A save flashes the light a colour — **blue for a local (device) save, green
 * for a cloud (disk) save**. To avoid flicker, a flash lasts at least
 * `FLASH_MS` and only one plays at a time: if a local and a cloud save land
 * together, one flashes, then the other (it waits its turn). Rapid repeats of a
 * colour already showing or already queued are coalesced, so a burst of saves
 * never builds a backlog — at most one local and one cloud flash wait.
 *
 * The queue dedupes by **consecutive** colour: a flash is dropped only when it
 * repeats whatever is already at the tail (current, or the last queued), so
 * colours can alternate (blue, green, blue) but the same colour never stutters
 * twice in a row.
 *
 * The queue transitions here are pure (tested); `useSaveLight` drives them with
 * a timer.
 *
 * @internal
 */
import * as React from "react";

export type SaveFlash = "local" | "cloud";

/** Blue = saved on device (local), green = saved to disk (cloud). Prototype
 * colours — tweak freely. */
export const FLASH_COLOR: Readonly<Record<SaveFlash, string>> = {
  local: "#0a84ff",
  cloud: "#32d74b",
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

/** Add a flash. Idle → it shows at once; busy → it waits, unless it would just
 * repeat the colour already at the tail (current, or the last queued), in which
 * case it's dropped — consecutive-colour dedupe. */
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

type Action = { readonly type: "flash"; readonly kind: SaveFlash } | { readonly type: "advance" };

const reducer = (state: SaveLightState, action: Action): SaveLightState =>
  action.type === "flash" ? enqueueFlash(state, action.kind) : advanceFlash(state);

/** The save light for React: `flash(kind)` to pulse it; `current` is the colour
 * key showing now (null at rest). The timer holds each flash for `FLASH_MS`
 * before advancing, so the light never flickers. */
export const useSaveLight = (): { readonly current: SaveFlash | null; readonly flash: (kind: SaveFlash) => void } => {
  const [state, dispatch] = React.useReducer(reducer, initialSaveLight);
  React.useEffect(() => {
    if (state.current === null) return;
    const handle = setTimeout(() => dispatch({ type: "advance" }), FLASH_MS);
    return () => clearTimeout(handle);
  }, [state]);
  const flash = React.useCallback((kind: SaveFlash) => dispatch({ type: "flash", kind }), []);
  return { current: state.current, flash };
};
