/**
 * The repo/workspace action menu — the "Files · Docs · Commits · Pull Requests"
 * set shown in the repo screen's header and, via the repo card's long-press, on
 * Home. One definition so the header and the card can't drift.
 *
 * A git checkout gets the full set; a workspace (a non-git session folder) only
 * gets Files and Docs. Actions aren't wired yet — these sections are future work,
 * so the entries are placeholders in both surfaces for now.
 *
 * @internal
 */
import type { SFSymbol } from "sf-symbols-typescript";

export type RepoMenuItem = {
  readonly label: string;
  readonly icon: SFSymbol;
};

export const REPO_MENU: ReadonlyArray<RepoMenuItem> = [
  { label: "Files", icon: "folder" },
  { label: "Docs", icon: "book" },
  { label: "Commits", icon: "arrow.triangle.branch" },
  { label: "Pull Requests", icon: "arrow.triangle.merge" },
];

/** A workspace isn't a git checkout, so no Commits / PRs. */
export const WORKSPACE_MENU: ReadonlyArray<RepoMenuItem> = [
  { label: "Files", icon: "folder" },
  { label: "Docs", icon: "book" },
];

export const repoMenuFor = (isRepo: boolean): ReadonlyArray<RepoMenuItem> => (isRepo ? REPO_MENU : WORKSPACE_MENU);
