/**
 * The repo/workspace action menu — the "Files · Docs · Git" set shown in the repo screen's header and, via the repo card's long-press, on
 * Home. One definition so the header and the card can't drift.
 *
 * A git checkout gets the full set; a workspace (a non-git session folder) only
 * gets Files and Docs. Git is one entry: its page holds commits, pull requests
 * and issues (docs/handoffs/double-agent-repo-screen-and-plugin-system.md
 * §21.1). Docs and Git are not wired yet; their pages are future work.
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
  { label: "Git", icon: "arrow.triangle.branch" },
];

/** A workspace isn't a git checkout, so no Git. */
export const WORKSPACE_MENU: ReadonlyArray<RepoMenuItem> = [
  { label: "Files", icon: "folder" },
  { label: "Docs", icon: "book" },
];

export const repoMenuFor = (isRepo: boolean): ReadonlyArray<RepoMenuItem> => (isRepo ? REPO_MENU : WORKSPACE_MENU);
