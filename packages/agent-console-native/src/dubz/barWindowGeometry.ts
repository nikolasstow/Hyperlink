/**
 * The bar window's geometry, as pure worklet-safe math — the single source of
 * truth for how tall the window is at a detent and how much of the screen it
 * covers. BarWindow's worklets call it (the detent stops, the window height),
 * and `coverOf` is what scroll views pad their bottom by so their last line
 * clears the window. Nothing here is measured; it is all design constants, the
 * detent fraction and the keyboard.
 *
 * Extracted from BarWindow unchanged: the numbers match what BarWindow drew.
 *
 * @internal
 */
import { COMPOSER_PILL_HEIGHT } from "../composerBarSpec";

/** The window's gap below the bar (its bottom sits this far up from the bar). */
export const BAR_GAP = 8;
/** The gap between the window's top and the header at full height. */
export const TOP_GAP = 8;
/** The collapsed height: the composer pill, and the smallest detent. */
export const MIN_HEIGHT = COMPOSER_PILL_HEIGHT;

/** The settled bar window at a moment: open or the bar, its detent, and the
 * keyboard (the full height the detents are sized from, and the settled live
 * height the window rides). */
export interface BarWindowState {
  readonly open: boolean;
  /** 0 = full height … 1 = the pill. */
  readonly frac: number;
  /** The full keyboard height the detents are computed from (0 if never up). */
  readonly kbFull: number;
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

/** How far the top is lowered from full to the pill, for a keyboard height —
 * the drag range. The detents live inside it. */
export const maxDragFor = (frame: ScreenFrame, keyboard: number): number => {
  "worklet";
  return Math.max(frame.height - fullTop(frame) - (Math.max(keyboard, restingBottom(frame.insetBottom)) + BAR_GAP) - MIN_HEIGHT, 0);
};

/** With a stop (a fixed rest height in place of half + pill): how far the top
 * is lowered from full to rest there. */
export const stopDragFor = (maxDrag: number, stop: number | undefined): number => {
  "worklet";
  return stop === undefined ? maxDrag : Math.max(maxDrag + MIN_HEIGHT - stop, 0);
};

/** Points from the screen's bottom to the window's top — what a scroll view
 * pads its bottom by. Collapsed, it is just the pill at rest; open, the pill
 * plus the detent's share of the drag range, both lifted by where the window
 * rests above the bottom (the live keyboard, or the resting inset). */
export const coverOf = (state: BarWindowState, frame: ScreenFrame): number => {
  "worklet";
  const windowBottom = Math.max(state.keyboard, restingBottom(frame.insetBottom)) + BAR_GAP;
  if (!state.open) return windowBottom + MIN_HEIGHT;
  const windowHeight = MIN_HEIGHT + maxDragFor(frame, state.kbFull) * (1 - state.frac);
  return windowBottom + windowHeight;
};

/** The window's top, from the screen's top (the inverse of the cover). */
export const windowTop = (state: BarWindowState, frame: ScreenFrame): number => {
  "worklet";
  return frame.height - coverOf(state, frame);
};

/** Whether two settled states are the same — so a report is skipped when
 * nothing moved (React never re-renders for an unchanged window). */
export const sameBarWindowState = (a: BarWindowState, b: BarWindowState): boolean =>
  a.open === b.open && a.frac === b.frac && a.kbFull === b.kbFull && a.keyboard === b.keyboard;
