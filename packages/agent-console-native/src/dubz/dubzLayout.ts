/**
 * Dubz's compact-layout math — pure, worklet-safe, the single source of truth
 * for when Dubz is "compact" and whether its content must shift aside for the
 * top-left buttons. BarWindow's height reaction and the Dubz body read it.
 *
 * The idea (agreed with the owner):
 * - A COMPACT ZONE of window heights, from the free-drag min (one suggestion
 *   row — the smallest that still shows content, not just the input) up to a
 *   rough ceiling of about three rows.
 * - In the zone, the top controls do not get their own row: there is not the
 *   height for one. So when the content is taller than the space left after the
 *   top AND bottom bars, the content keeps a gap on the left for the left
 *   button and flows to its right; the right button hides.
 * - Out of the zone, the top controls take their own row at the top and the
 *   content sits below them (the full height math reserves both bars).
 *
 * Bar heights are passed in (Dubz owns those constants) so this module stays
 * free of UI imports and testable.
 *
 * @internal
 */

/** The compact zone's ceiling: Dubz is compact at or below this visible height.
 * A ROUGH value (about three suggestion rows) — the behaviour is about the space
 * available, not an exact row count, so expect to tune this on device. */
export const COMPACT_ZONE_MAX = 320;

/** Whether Dubz is compact at this visible height. */
export const isCompact = (height: number): boolean => {
  "worklet";
  return height <= COMPACT_ZONE_MAX;
};

/** The space left for content. Out of the compact zone the top controls take
 * their own row, so BOTH bars are subtracted. In the zone they are a side bar
 * (horizontal, not a row), so the top bar is NOT subtracted — only the bottom:
 *
 *   compact:      height − bottomBar
 *   not compact:  height − topBar − bottomBar
 */
export const contentViewport = (height: number, topBar: number, bottomBar: number): number => {
  "worklet";
  return isCompact(height) ? height - bottomBar : height - topBar - bottomBar;
};

/** Whether the content must compact — shift right for the top-left buttons:
 * Dubz is compact, and the content is taller than the content viewport. */
export const needsCompactContent = (height: number, contentHeight: number, topBar: number, bottomBar: number): boolean => {
  "worklet";
  return isCompact(height) && contentHeight > contentViewport(height, topBar, bottomBar);
};
