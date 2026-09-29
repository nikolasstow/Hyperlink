/**
 * Which suggestions Dubz shows, from the page it was opened on and what that
 * page is about. The one place these rules live: pages say where they are
 * (`DubzContext`), and this says what fits there.
 *
 * Suggestions come in kinds. A **block** is full width (the tasks block);
 * smaller kinds come later.
 *
 * @internal
 */
import type { AgentSurface } from "./agentButtonSettings";

/** What a page is about. */
export type DubzScope =
  /** Everything (Home, a session for now): the user picks a repo. */
  | { readonly kind: "all" }
  /** One repo. */
  | { readonly kind: "repo"; readonly repo: string }
  /** A folder that is not a repo (a workspace). */
  | { readonly kind: "folder" };

/** Where Dubz was opened. */
export interface DubzContext {
  readonly surface: AgentSurface;
  readonly scope: DubzScope;
}

/** A suggestion to show. */
export type DubzSuggestion =
  /** The repo's open tasks by kind, and New Task: a block. `repo` is fixed
   * when the page is about one repo; otherwise the block picks one. */
  { readonly kind: "tasks"; readonly repo: string | undefined };

export const suggestionsFor = (context: DubzContext): ReadonlyArray<DubzSuggestion> => {
  switch (context.scope.kind) {
    case "all":
      return [{ kind: "tasks", repo: undefined }];
    case "repo":
      return [{ kind: "tasks", repo: context.scope.repo }];
    case "folder":
      // Tasks are a repo's GitHub issues; a plain folder has none.
      return [];
  }
};
