/**
 * Where you are in a file, as VS Code's breadcrumbs read it: the file's path
 * from its worktree's root, then the named scopes the current line is in
 * (`class Foo`, `func bar`), outermost first.
 *
 * The scopes come from the same parsed ranges sticky scroll pins
 * (stickyRanges.ts); only the named ones are crumbs.
 *
 * @internal
 */
import type { StickyRange } from "./stickyRanges";

/** The named scopes `line` (0-based) is in, outermost first. */
export const scopesAt = (ranges: ReadonlyArray<StickyRange>, line: number): ReadonlyArray<string> =>
  [...ranges]
    .filter((range) => range.header <= line && line <= range.end)
    .sort((a, b) => a.start - b.start || a.depth - b.depth)
    .flatMap((range) => (range.label === undefined ? [] : [range.label]));

/** The file's path as crumbs: from `root` when it is under it, else whole. */
export const pathCrumbs = (path: string, root: string | undefined): ReadonlyArray<string> => {
  const base = root === undefined ? "" : root.endsWith("/") ? root : `${root}/`;
  const relative = base !== "" && path.startsWith(base) ? path.slice(base.length) : path;
  return relative.split("/").filter((segment) => segment !== "");
};
