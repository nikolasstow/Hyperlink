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
 * Rendered height of the COLLAPSED glass pill = 58. Its field pads
 * `COMPOSER_FIELD_PADDING` top and bottom around the tallest control in the row,
 * the send chip (`COMPOSER_SEND_CHIP_SIZE`). When collapsed the send chip is only
 * *width*-collapsed (overflow-clipped to 0 wide); its 38pt HEIGHT still sets the
 * row height, so the pill stays 58, not 52. The search pill uses this as its
 * fixed height, and it's the composer's initial value (the composer then measures
 * the real collapsed height at runtime, which lands here too).
 */
export const COMPOSER_PILL_HEIGHT = COMPOSER_SEND_CHIP_SIZE + COMPOSER_FIELD_PADDING * 2;
