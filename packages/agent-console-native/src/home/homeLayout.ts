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
