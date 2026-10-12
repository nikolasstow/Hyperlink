/**
 * Home's cards at a few set heights, and Home's layout as the launch screen
 * draws it before Home is up. A card's size is worked out from what it shows
 * (rounded up: big enough is enough) and it is drawn at that height, its
 * content at its top; it changes only when what it shows changes. Home keeps
 * its first screenful (headings and sizes, in order) on the device; the
 * launch screen draws blank cards to it, so the two match.
 *
 * @internal
 */
import { Schema } from "effect";

/** A session card's size, by how much it shows. */
export const CardSize = Schema.Literals(["small", "medium", "large"]);
export type CardSize = typeof CardSize.Type;

export const HomeRow = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("heading"), title: Schema.String, first: Schema.Boolean }),
  Schema.Struct({ kind: Schema.Literal("session"), size: CardSize }),
  Schema.Struct({ kind: Schema.Literal("repo"), latest: Schema.Boolean }),
  Schema.Struct({ kind: Schema.Literal("server") }),
  Schema.Struct({ kind: Schema.Literal("favLocation") }),
]);
export type HomeRow = typeof HomeRow.Type;

export const HomeLayout = Schema.Array(HomeRow);
export type HomeLayout = typeof HomeLayout.Type;

/** Rows kept: the first screenful and more. */
export const LAYOUT_ROWS = 12;

/** A session card's height at each size (its padding, title, the rows it may
 * add, its meta line), each rounded up. */
export const SESSION_CARD_HEIGHT: Readonly<Record<CardSize, number>> = {
  // Padding 28, a title line 21, its meta 13, 8 between.
  small: 76,
  // A second title line, the pills (18), or the last message (2 lines, 32).
  medium: 112,
  // Up to all of them.
  large: 160,
};

/** A repo card's height, with or without its latest session's title. */
export const REPO_CARD_HEIGHT = { latest: 92, plain: 68 };

/** A server card's height (name line + address line, padding). */
export const SERVER_CARD_HEIGHT = 72;

/** A favorited file/folder (location) card's height on Home. */
export const FAV_LOCATION_CARD_HEIGHT = 60;

/** The gap under each card, and the cards' side margin (Home's). */
export const CARD_GAP = 10;
export const CARD_GUTTER = 12;

/** Characters of a 17pt semibold title taken to fill one line of a card:
 * fewer than fit, so a title given one line never needs two. */
const TITLE_LINE_CHARS = 30;

/** The lines a session card gives its title (it is held to them). */
export const titleLines = (title: string): 1 | 2 => (title.length > TITLE_LINE_CHARS ? 2 : 1);

/** How much a session card shows, as a size: its title's lines, its repo
 * and worktree pills, its last message (up to two lines). */
export const sessionCardSize = (card: { readonly title: string; readonly pills: boolean; readonly summary: boolean }): CardSize => {
  const rows = titleLines(card.title) + (card.pills ? 1 : 0) + (card.summary ? 2 : 0);
  return rows <= 1 ? "small" : rows <= 3 ? "medium" : "large";
};

/** Characters of a 13pt summary line taken to fill one line (fewer than fit,
 * like the title's), so a summary given one line never wraps to two. */
const SUMMARY_LINE_CHARS = 30;

/** The lines a card's summary takes, 0 when it has none, capped at the two the
 * card shows (CardBody's `lineLimit(2)`). A char estimate like `titleLines`, so
 * it is known from the cached text — no measuring, right on first render. */
export const summaryLines = (summary: string | undefined): 0 | 1 | 2 => (summary === undefined ? 0 : summary.length > SUMMARY_LINE_CHARS ? 2 : 1);

// The pieces CardBody stacks (its `padding({ all: 14 })` and `spacing={8}`),
// each rounded up a touch so a card is never too short for its content.
const CARD_PAD = 14;
const CARD_VSTACK_GAP = 8;
const TITLE_LINE_H = 21;
const PILLS_ROW_H = 20;
const SUMMARY_LINE_H = 17;
const META_LINE_H = 15;

/** A session card's exact height from what it shows — title lines, optional
 * pills, summary lines (0–2), and the meta line — so each card best-fits its
 * content (many heights, not three buckets). Pure over the cached title and
 * summary, so the right height is there the moment the page loads. */
export const sessionCardHeight = (content: { readonly titleLines: number; readonly pills: boolean; readonly summaryLines: number }): number => {
  const rows: Array<number> = [content.titleLines * TITLE_LINE_H];
  if (content.pills) rows.push(PILLS_ROW_H);
  if (content.summaryLines > 0) rows.push(content.summaryLines * SUMMARY_LINE_H);
  rows.push(META_LINE_H);
  const stacked = rows.reduce((total, row) => total + row, 0) + (rows.length - 1) * CARD_VSTACK_GAP;
  return Math.ceil(CARD_PAD * 2 + stacked);
};
