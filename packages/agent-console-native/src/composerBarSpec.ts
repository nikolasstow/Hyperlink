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

/**
 * Rendered height of the collapsed glass pill: its field pads 10pt top and
 * bottom around the tallest control (the send chip). The standalone assistant
 * button and the search pill both size to this so they read level with it.
 */
export const COMPOSER_PILL_HEIGHT = COMPOSER_SEND_CHIP_SIZE + 20;
