/**
 * Shared design tokens for the app's standard header title pill — the title
 * text in a Liquid Glass capsule. There are two renderers of this one design:
 *
 *  - `HeaderTitlePill` — for a native nav bar's `headerTitle` slot (`@expo/ui`
 *    SwiftUI `Host`); used by chat, session list, file explorer.
 *  - `TitlePill` — for our own custom RN headers (`expo-glass-effect`), e.g. the
 *    collapsing glass header; the version to reuse on future custom pages.
 *
 * Both pull their height, font, padding and dot sizing from here so the two
 * renderers stay pixel-identical.
 *
 * @internal
 */
export const PILL_HEIGHT = 44;
export const PILL_FONT_SIZE = 15;
/** react-native `fontWeight` matching SwiftUI's `semibold`. */
export const PILL_FONT_WEIGHT = "600" as const;
export const PILL_PAD_H = 14;
export const PILL_DOT_SIZE = 7;
/** Gap between the title and the trailing status dot. */
export const PILL_DOT_GAP = 8;
/** Capsule corner radius. */
export const PILL_RADIUS = PILL_HEIGHT / 2;

/** Average glyph advance as a fraction of font size for the system font at
 * semibold — deliberately generous so a synchronous estimate never truncates.
 * The title is always known up front, so the native pill sizes itself from this
 * rather than an async measure-and-resize (which flashes). */
const AVG_GLYPH_RATIO = 0.62;

/** Content-fitting pill width for a known title, computed synchronously (no
 * layout round-trip). Callers clamp to their own max so it can't reach the nav
 * items. */
export const titlePillWidth = (title: string, hasDot: boolean): number => {
  const text = Math.ceil(title.length * PILL_FONT_SIZE * AVG_GLYPH_RATIO);
  const dot = hasDot ? PILL_DOT_SIZE + PILL_DOT_GAP : 0;
  return text + PILL_PAD_H * 2 + dot;
};

