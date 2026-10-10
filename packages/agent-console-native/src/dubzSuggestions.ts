/**
 * The page context Dubz reads, and which suggestions it shows from it. Pages say
 * where they are (`scope`) and what is actionable there (`entries`); this says
 * what fits.
 *
 * `entries` is the future-proof part — the capabilities a page publishes, each
 * carrying everything a script or model needs (a file reference, optional model
 * instructions). It is an Effect `Schema` (a tagged union over a shared
 * `FileRef`) because it crosses into Laya, model prompts, and maybe
 * persistence/sync, so it wants validation, a JSON codec, and additive-only
 * evolution. See docs/handoffs/dubz-sessions-and-suggestions.md.
 *
 * Standard: unions discriminate on `_tag`; no catch-all entry — every capability
 * is its own typed kind, and we expand by adding well-defined kinds.
 *
 * @internal
 */
import { Schema } from "effect";
import type { AgentSurface } from "./agentButtonSettings";

/** A file or folder a capability points at. The `FileNavEntry` shape, reused. */
export const FileRef = Schema.Struct({
  repo: Schema.String,
  path: Schema.String,
  name: Schema.String,
  kind: Schema.Literals(["file", "directory"]),
});
export type FileRef = typeof FileRef.Type;

/**
 * A thing on the page Dubz can act on. A tagged union — add well-defined kinds
 * to grow it; never a catch-all. Each entry carries an `id` (so a suggestion can
 * point back at it), the file(s) it concerns, and optional model `instructions`.
 */
export const DubzContextEntry = Schema.Union([
  /** An editable document (the manifest behind a package page, say): Dubz can
   * offer to edit it, and the sessions that touched it. */
  Schema.TaggedStruct("EditableDocument", {
    id: Schema.String,
    file: FileRef,
    instructions: Schema.optional(Schema.String),
    label: Schema.optional(Schema.String),
  }),
  /** A read-only reference the model may consult, not change. */
  Schema.TaggedStruct("ReferenceDocument", {
    id: Schema.String,
    file: FileRef,
    label: Schema.optional(Schema.String),
  }),
]);
export type DubzContextEntry = typeof DubzContextEntry.Type;

/** What a page is about. */
export type DubzScope =
  /** Everything (Home, a session for now): the user picks a repo. */
  | { readonly _tag: "All" }
  /** One repo. */
  | { readonly _tag: "Repo"; readonly repo: string }
  /** A folder that is not a repo (a workspace). */
  | { readonly _tag: "Folder" };

/** Where Dubz was opened: the surface, what it is about, and what is actionable
 * there. `entries` is omitted where a page publishes nothing. */
export interface DubzContext {
  readonly surface: AgentSurface;
  readonly scope: DubzScope;
  readonly entries?: ReadonlyArray<DubzContextEntry>;
}

/** A suggestion to show. One row per type. */
export type DubzSuggestion =
  /** The sessions around an editable document: one row — the most related
   * session, and the count in its worktree. Rendered from live session data. */
  | { readonly _tag: "Sessions"; readonly file: FileRef }
  /** The repo's open tasks by kind, and New Task: a block. `repo` is fixed
   * when the page is about one repo; otherwise the block picks one. */
  | { readonly _tag: "Tasks"; readonly repo: string | undefined };

const tasksFor = (scope: DubzScope): ReadonlyArray<DubzSuggestion> => {
  switch (scope._tag) {
    case "All":
      return [{ _tag: "Tasks", repo: undefined }];
    case "Repo":
      return [{ _tag: "Tasks", repo: scope.repo }];
    case "Folder":
      // Tasks are a repo's GitHub issues; a plain folder has none.
      return [];
  }
};

export const suggestionsFor = (context: DubzContext): ReadonlyArray<DubzSuggestion> => {
  // The session row leads when the page publishes an editable document.
  const editable = (context.entries ?? []).find((entry) => entry._tag === "EditableDocument");
  const sessions: ReadonlyArray<DubzSuggestion> = editable === undefined ? [] : [{ _tag: "Sessions", file: editable.file }];
  return [...sessions, ...tasksFor(context.scope)];
};
