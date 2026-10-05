/**
 * A tab preview's shape, shared by the preview, the overview's grid and the
 * zoom in and out of it.
 *
 * @internal
 */

/** A preview's height to its width (3:4, as Safari's). */
export const PREVIEW_ASPECT = 4 / 3;
/** The previews' corner radius. */
export const PREVIEW_RADIUS = 14;

/** Swiping between tabs, each page is a card this much of the screen, this
 * far from the next. */
export const CARD_SCALE = 0.9;
export const CARD_GAP = 14;

/** How far apart the cards' middles are, as the page shrinks into a card
 * (`paging` 1) and grows back (0): apart by a gap either way, so a page
 * grown back to the screen has its neighbours wholly off it. */
export const cardStepAt = (screenWidth: number, paging: number): number => {
  "worklet";
  return screenWidth * (1 - (1 - CARD_SCALE) * paging) + CARD_GAP;
};
