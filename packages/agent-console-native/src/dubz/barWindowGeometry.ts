/**
 * The bar window's geometry, as pure worklet-safe math — the single source of
 * truth for how tall the window is and how much of the screen it covers.
 *
 * The model (agreed with the owner):
 * - The window has a REQUESTED height: the user's remembered default, or an
 *   active component's height when that is taller. The keyboard NEVER changes
 *   the requested height.
 * - The VISIBLE height is the requested height CLAMPED to the space available
 *   above the keyboard (`maxHeightFor`). So the keyboard only moves the clamp:
 *   it shows less when the keyboard is up, and returns to the full requested
 *   height when the keyboard goes down. The window never hides behind the
 *   keyboard.
 * - Resting (drag release): two low anchors — the pill (the bar) and
 *   `minOpenHeight` (one suggestion) — and free rest anywhere between
 *   `minOpenHeight` and the max.
 *
 * `coverOf` is what scroll views pad their bottom by (through `useBarCover`) so
 * their last line clears the window. Nothing here is measured; it is all design
 * constants, the settled height and the keyboard.
 *
 * @internal
 */
import { COMPOSER_PILL_HEIGHT } from "../composerBarSpec";

/** The window's gap below the bar (its bottom sits this far up from the bar). */
export const BAR_GAP = 8;
/** The gap between the window's top and the header at full height. */
export const TOP_GAP = 8;
/** The collapsed height: the composer pill — the bar, and the lowest the open
 * window ever reports (the pill alone). */
export const MIN_HEIGHT = COMPOSER_PILL_HEIGHT;

/** The settled bar window at a moment, for the cover a screen pads by: open or
 * the bar, its settled visible height (pill up), and the settled keyboard. */
export interface BarWindowState {
  readonly open: boolean;
  /** The settled visible height, from the pill's bottom up (>= MIN_HEIGHT). */
  readonly height: number;
  /** The keyboard's settled height, 0 when down. */
  readonly keyboard: number;
}

/** The screen the window sits in — its size, header and safe-area insets. */
export interface ScreenFrame {
  readonly height: number;
  readonly headerHeight: number;
  readonly insetTop: number;
  readonly insetBottom: number;
}

/** Where the floating composer rests when the keyboard is down (useKeyboardSlide
 * / composerRestingBottom): tucked below the home-indicator inset, a floor gap. */
const restingBottom = (insetBottom: number): number => {
  "worklet";
  return Math.max(insetBottom - 16, 6);
};

/** The window's top at full height, from the screen's top. */
const fullTop = (frame: ScreenFrame): number => {
  "worklet";
  return Math.max(frame.headerHeight, frame.insetTop) + TOP_GAP;
};

/** Points from the screen's bottom to the window's bottom: the keyboard (or the
 * resting inset when it is down), and the window's gap above the bar. */
const windowBottomFor = (keyboard: number, frame: ScreenFrame): number => {
  "worklet";
  return Math.max(keyboard, restingBottom(frame.insetBottom)) + BAR_GAP;
};

/** The tallest the VISIBLE window can be for a keyboard height — the space from
 * its bottom up to the full-height top. This is the clamp: the keyboard moves
 * it, never the requested height, so the window always stays above the keyboard. */
export const maxHeightFor = (frame: ScreenFrame, keyboard: number): number => {
  "worklet";
  return Math.max(frame.height - fullTop(frame) - windowBottomFor(keyboard, frame), MIN_HEIGHT);
};

/** The requested height made visible: at least the pill, at most the space above
 * the keyboard. The keyboard only tightens the clamp; the request is unchanged. */
export const clampRequested = (requested: number, frame: ScreenFrame, keyboard: number, floor: number = MIN_HEIGHT): number => {
  "worklet";
  const max = maxHeightFor(frame, keyboard);
  // The floor is the collapsed bar — normally the one-line pill (MIN_HEIGHT),
  // but a grown composer input raises it so the window never clips the input.
  // Never below MIN_HEIGHT, never above the max.
  const lo = floor < MIN_HEIGHT ? MIN_HEIGHT : floor > max ? max : floor;
  return requested < lo ? lo : requested > max ? max : requested;
};

/** Where a drag release settles, in visible-height points — assuming it is not
 * a dismiss (the caller decides that first). With `freeAbove` (Dubz) there are
 * two low anchors — the pill (`MIN_HEIGHT`, the bar) and `minOpen` (one
 * suggestion); below `minOpen` it snaps to the nearer of those two, at or above
 * it rests exactly where it was let go, capped at `max` (a free-for-all between
 * `minOpen` and the top). Without `freeAbove` (the model picker) it snaps to
 * the nearer of `minOpen` and `max`. `projected` folds in a little release
 * momentum. */
export const snapOpenHeight = (release: number, projected: number, minOpen: number, max: number, freeAbove: boolean): number => {
  "worklet";
  if (!freeAbove) {
    const mid = (minOpen + max) / 2;
    return projected < mid ? minOpen : max;
  }
  if (projected < minOpen) {
    const mid = (MIN_HEIGHT + minOpen) / 2;
    return projected < mid ? MIN_HEIGHT : minOpen;
  }
  return release > max ? max : release;
};

/** Points from the screen's bottom to the window's top — what a scroll view
 * pads its bottom by. The settled visible height over the window's bottom; the
 * pill alone when collapsed. */
export const coverOf = (state: BarWindowState, frame: ScreenFrame): number => {
  "worklet";
  return windowBottomFor(state.keyboard, frame) + (state.open ? state.height : MIN_HEIGHT);
};

/** The window's top, from the screen's top (the inverse of the cover). */
export const windowTop = (state: BarWindowState, frame: ScreenFrame): number => {
  "worklet";
  return frame.height - coverOf(state, frame);
};

/** Whether two settled states are the same — so a report is skipped when
 * nothing moved (React never re-renders for an unchanged window). */
export const sameBarWindowState = (a: BarWindowState, b: BarWindowState): boolean =>
  a.open === b.open && a.height === b.height && a.keyboard === b.keyboard;
