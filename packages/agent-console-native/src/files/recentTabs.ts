/**
 * The files and folders opened most recently across every repo's Files — from
 * the per-repo histories (FileNav), newest first, one per path. Home shows a
 * few as a grid so a recent file is a tap away.
 *
 * @internal
 */
import type { FileNavEntry, FilePlace } from "./FileNav";
import { under } from "./pathForms";

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

/** A repo's worktrees, for placing a recent entry within one. */
export interface WorktreeRef {
  readonly name: string;
  readonly path: string;
}

/** The entry's path relative to the deepest worktree that contains it (and that
 * worktree), e.g. `src/files` under `main`. Outside every worktree, the path is
 * returned whole with no worktree. */
const relativeIn = (path: string, worktrees: ReadonlyArray<WorktreeRef>): { readonly worktree: WorktreeRef | undefined; readonly relative: string } => {
  let best: WorktreeRef | undefined;
  let bestRest: string | undefined;
  for (const worktree of worktrees) {
    const rest = under(path, worktree.path);
    if (rest !== undefined && (best === undefined || worktree.path.length > best.path.length)) {
      best = worktree;
      bestRest = rest;
    }
  }
  return { worktree: best, relative: bestRest === undefined ? path : bestRest.replace(/^\//, "") };
};

/** The subtitle under each recent on Home, in the same order: the parent
 * folder's path relative to its worktree (the component shows the end of it).
 * When two recents are the same relative path in different worktrees — the one
 * case the relative path can't tell apart — their subtitle is the worktree name
 * instead. A recent at a worktree's root falls back to the worktree name. */
export const recentSubtitlesOf = (tabs: ReadonlyArray<RecentTab>, worktreesByRepo: ReadonlyMap<string, ReadonlyArray<WorktreeRef>>): ReadonlyArray<string> => {
  const placed = tabs.map((tab) => relativeIn(tab.entry.path, worktreesByRepo.get(tab.repo) ?? []));
  // Same repo + same within-worktree path ⇒ same place in different worktrees
  // (one repo can't hold the same path twice), so the relative path collides.
  const counts = new Map<string, number>();
  tabs.forEach((tab, index) => {
    const key = `${tab.repo}\n${placed[index]?.relative ?? ""}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return tabs.map((tab, index) => {
    const info = placed[index];
    const relative = info?.relative ?? tab.entry.path;
    const key = `${tab.repo}\n${relative}`;
    if ((counts.get(key) ?? 0) > 1 && info?.worktree !== undefined) return info.worktree.name;
    const parent = relative.includes("/") ? relative.slice(0, relative.lastIndexOf("/")) : "";
    return parent === "" ? (info?.worktree?.name ?? "") : parent;
  });
};
