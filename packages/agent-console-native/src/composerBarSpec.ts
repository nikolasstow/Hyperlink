/**
 * Single source of truth for the composer's +/send chip sizing, shared by
 * every screen that renders `Composer.tsx` (chat and Home both do) so the
 * two can't drift apart.
 *
 * Previously this also carried `COMPOSER_BAR_HEIGHT`/`_PADDING`/`_SPACING`,
 * which sized `HomeComposerBar.tsx`'s decoy pill — a non-editable bar that
 * stood in for a composer on Home. That component is gone; Home now renders
 * the real `Composer` directly, so those constants had no remaining
 * consumer.
 *
 * @internal
 */
export const COMPOSER_CHIP_SIZE = 32;
export const COMPOSER_SEND_CHIP_SIZE = 38;

/** Padding the glass field puts above and below its controls row. */
export const COMPOSER_FIELD_PADDING = 10;

/**
 * Rendered height of the COLLAPSED glass pill. Its field pads
 * `COMPOSER_FIELD_PADDING` top and bottom around the tallest *visible* control —
 * which, collapsed, is the +/model chip (`COMPOSER_CHIP_SIZE`); the taller send
 * chip is hidden. So the pill is 52, not 58. The standalone assistant button and
 * the search pill both size to this so they sit flush with the pill's height.
 * (The composer measures the real collapsed height at runtime and uses that; this
 * is the initial value and the search pill's fixed height.)
 */
export const COMPOSER_PILL_HEIGHT = COMPOSER_CHIP_SIZE + COMPOSER_FIELD_PADDING * 2;
