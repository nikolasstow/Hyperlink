/**
 * Where everything in the tab overview sits, from the screen's size and the
 * tabs alone (nothing measured), so the grid draws it and the zoom in and out
 * lands on it.
 *
 * Tabs are in a two-column grid, in their order, in blocks: the tabs of a
 * folder that has more than one open together under that folder's path (the
 * path no longer under each), and the rest together, each with its folder
 * under its name. Blocks come in the order of their first tab.
 *
 * Positions are in the grid's own space (its top at 0): a tab is on screen at
 * its `y` less how far the grid is scrolled.
 *
 * @internal
 */
import type { FileNavEntry, FilePlace } from "./FileNav";
import { PREVIEW_ASPECT } from "./tabShape";

export type TabFilter = "all" | "files" | "folders";

const SIDE = 16;
const GAP = 14;
/** Under each preview: its name, and its folder (when not grouped). */
const LABEL_HEIGHT = 40;
const ROW_GAP = 18;
/** A group's folder path above it, and the space before a block. */
const HEADER_HEIGHT = 30;
const BLOCK_GAP = 10;

export interface LaidTab {
  /** Its place among all the tabs. */
  readonly index: number;
  readonly entry: FileNavEntry;
  readonly x: number;
  readonly y: number;
  /** In a folder's group (its folder is the header, not under its name). */
  readonly grouped: boolean;
}

export interface LaidHeader {
  readonly folder: string;
  readonly y: number;
}

export interface TabLayout {
  readonly side: number;
  readonly cellWidth: number;
  readonly previewHeight: number;
  readonly cellHeight: number;
  readonly headerHeight: number;
  readonly tabs: ReadonlyArray<LaidTab>;
  readonly headers: ReadonlyArray<LaidHeader>;
  /** The grid's height, its top padding included. */
  readonly height: number;
}

/** The folder something is in. */
export const parentOf = (path: string): string => {
  const trimmed = path.replace(/\/+$/, "");
  const cut = trimmed.lastIndexOf("/");
  return cut <= 0 ? "/" : trimmed.slice(0, cut);
};

const shown = (entry: FileNavEntry, filter: TabFilter): boolean =>
  filter === "all" || (filter === "files" && entry.kind === "file") || (filter === "folders" && entry.kind === "directory");

/** The tabs a filter shows, with their places among all tabs; `extra`, a tab
 * about to be added, after the last. */
export const filteredTabs = (place: FilePlace, filter: TabFilter, extra?: FileNavEntry): ReadonlyArray<{ readonly index: number; readonly entry: FileNavEntry }> => {
  const tabs = place.tabs.flatMap((tab, index) => {
    const entry = tab.entries[tab.index];
    return entry === undefined || !shown(entry, filter) ? [] : [{ index, entry }];
  });
  return extra !== undefined && shown(extra, filter) ? [...tabs, { index: place.tabs.length, entry: extra }] : tabs;
};

export const tabLayout = (
  place: FilePlace,
  filter: TabFilter,
  screen: { readonly width: number },
  topInset: number,
  extra?: FileNavEntry,
): TabLayout => {
  const cellWidth = (screen.width - SIDE * 2 - GAP) / 2;
  const previewHeight = cellWidth * PREVIEW_ASPECT;
  const cellHeight = previewHeight + LABEL_HEIGHT;
  const rowHeight = cellHeight + ROW_GAP;
  const tabs = filteredTabs(place, filter, extra);

  // A folder with more than one tab is a group; the rest are one block.
  const counts = new Map<string, number>();
  for (const tab of tabs) counts.set(parentOf(tab.entry.path), (counts.get(parentOf(tab.entry.path)) ?? 0) + 1);
  const LOOSE = "";
  const blockOf = (entry: FileNavEntry): string => {
    const folder = parentOf(entry.path);
    return (counts.get(folder) ?? 0) > 1 ? folder : LOOSE;
  };
  const order: Array<string> = [];
  const members = new Map<string, Array<{ readonly index: number; readonly entry: FileNavEntry }>>();
  for (const tab of tabs) {
    const block = blockOf(tab.entry);
    const list = members.get(block);
    if (list === undefined) {
      order.push(block);
      members.set(block, [tab]);
    } else list.push(tab);
  }

  const laid: Array<LaidTab> = [];
  const headers: Array<LaidHeader> = [];
  let y = topInset + 12;
  order.forEach((block, blockIndex) => {
    if (blockIndex > 0) y += BLOCK_GAP;
    if (block !== LOOSE) {
      headers.push({ folder: block, y });
      y += HEADER_HEIGHT;
    }
    const list = members.get(block) ?? [];
    list.forEach((tab, position) => {
      laid.push({
        index: tab.index,
        entry: tab.entry,
        x: SIDE + (position % 2) * (cellWidth + GAP),
        y: y + Math.floor(position / 2) * rowHeight,
        grouped: block !== LOOSE,
      });
    });
    y += Math.ceil(list.length / 2) * rowHeight;
  });

  return { side: SIDE, cellWidth, previewHeight, cellHeight, headerHeight: HEADER_HEIGHT, tabs: laid, headers, height: y };
};
