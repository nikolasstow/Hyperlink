/**
 * The files and folders opened most recently across every repo's Files — from
 * the per-repo histories (FileNav), newest first, one per path. Home shows a
 * few as a grid so a recent file is a tap away.
 *
 * @internal
 */
import type { FileNavEntry, FilePlace } from "./FileNav";

export interface RecentTab {
  readonly repo: string;
  readonly entry: FileNavEntry;
  /** When it was last opened. */
  readonly at: number;
}

/** The `limit` most recently opened entries across all repos, newest first,
 * deduped by path (the newest open of each). */
export const recentTabsOf = (places: Iterable<readonly [string, FilePlace]>, limit: number): ReadonlyArray<RecentTab> => {
  const all: Array<RecentTab> = [];
  for (const [repo, place] of places) {
    for (const visit of place.history) all.push({ repo, entry: visit.entry, at: visit.at });
  }
  all.sort((a, b) => b.at - a.at);
  const seen = new Set<string>();
  const recent: Array<RecentTab> = [];
  for (const tab of all) {
    if (seen.has(tab.entry.path)) continue;
    seen.add(tab.entry.path);
    recent.push(tab);
    if (recent.length >= limit) break;
  }
  return recent;
};
