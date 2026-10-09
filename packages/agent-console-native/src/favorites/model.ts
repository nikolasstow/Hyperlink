/**
 * Favorites: a **(page, input)** target pinned to a **scope**.
 *
 * The page is the kind; the input is its identity — a session needs its id, a
 * server its id, the file browser its location. Files and folders are locations
 * in the file browser, not pages (the browser works like a web browser, files
 * and folders are the URLs you browse), so they carry their repo + path. A
 * scope is the page a board belongs to — Home, a repo/workspace, or a server;
 * "where you favorite from" is the scope it lands in.
 *
 * The schema is the single source of truth: its JSON codec persists favorites
 * (Favorites.ts), and equality is **derived from it** (Schema.toEquivalence),
 * never hand-written. See docs/handoffs/scoped-favorites.md.
 *
 * @internal
 */
import { Schema } from "effect";

// --- A favorite target: a page + its identity-bearing input. One Struct per
// page; the `page` literal discriminates, the rest is that page's input. ---

export const SessionFavorite = Schema.Struct({
  page: Schema.Literal("session"),
  id: Schema.String,
});

/** A repo or a workspace, by its name on Home. */
export const RepoFavorite = Schema.Struct({
  page: Schema.Literal("repo"),
  name: Schema.String,
});

export const ServerFavorite = Schema.Struct({
  page: Schema.Literal("server"),
  id: Schema.String,
});

/** A file: the file browser bound to a location (repo + path). */
export const FileFavorite = Schema.Struct({
  page: Schema.Literal("file"),
  repo: Schema.String,
  path: Schema.String,
  name: Schema.String,
});

/** A folder: the file browser bound to a location (repo + path). */
export const FolderFavorite = Schema.Struct({
  page: Schema.Literal("folder"),
  repo: Schema.String,
  path: Schema.String,
  name: Schema.String,
});

export const FavoriteTarget = Schema.Union([
  SessionFavorite,
  RepoFavorite,
  ServerFavorite,
  FileFavorite,
  FolderFavorite,
]);
export type FavoriteTarget = typeof FavoriteTarget.Type;

// --- A scope: the page a board belongs to, tagged so an illegal scope can't
// be represented. ---

export const Scope = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("home"),
  }),
  Schema.Struct({
    _tag: Schema.Literal("repo"),
    name: Schema.String,
  }),
  Schema.Struct({
    _tag: Schema.Literal("server"),
    id: Schema.String,
  }),
]);
export type Scope = typeof Scope.Type;

// --- The persisted shape: one board (ordered targets) per scope. ---

export const Board = Schema.Struct({
  scope: Scope,
  items: Schema.Array(FavoriteTarget),
});
export type Board = typeof Board.Type;

export const ScopedFavorites = Schema.Array(Board);
export type ScopedFavorites = typeof ScopedFavorites.Type;

// --- Identity, derived from the schema (no hand-written comparators). Two
// favorites are the same only when page AND input match; two scopes when tag
// and input match. ---

const targetEquivalence = Schema.toEquivalence(FavoriteTarget);
const scopeEquivalence = Schema.toEquivalence(Scope);

export const sameTarget = (a: FavoriteTarget, b: FavoriteTarget): boolean => targetEquivalence(a, b);
export const sameScope = (a: Scope, b: Scope): boolean => scopeEquivalence(a, b);

// --- Scope constructors. ---

export const homeScope: Scope = { _tag: "home" };
export const repoScope = (name: string): Scope => ({ _tag: "repo", name });
export const serverScope = (id: string): Scope => ({ _tag: "server", id });

// --- Target constructors. ---

export const sessionTarget = (id: string): FavoriteTarget => ({ page: "session", id });
export const repoTarget = (name: string): FavoriteTarget => ({ page: "repo", name });
export const serverTarget = (id: string): FavoriteTarget => ({ page: "server", id });

export const fileTarget = (repo: string, path: string, name: string): FavoriteTarget => ({
  page: "file",
  repo,
  path,
  name,
});

export const folderTarget = (repo: string, path: string, name: string): FavoriteTarget => ({
  page: "folder",
  repo,
  path,
  name,
});

// --- Pure board operations. ---

/** The targets pinned to a scope, in order (empty when none). */
export const boardItems = (favorites: ScopedFavorites, scope: Scope): ReadonlyArray<FavoriteTarget> =>
  favorites.find((board) => sameScope(board.scope, scope))?.items ?? [];

export const isFavorited = (favorites: ScopedFavorites, scope: Scope, target: FavoriteTarget): boolean =>
  boardItems(favorites, scope).some((each) => sameTarget(each, target));

/** The scope's board replaced with `items`, keeping every other board in place;
 * an empty board is dropped so a scope without favorites leaves no trace. */
const withBoard = (favorites: ScopedFavorites, scope: Scope, items: ReadonlyArray<FavoriteTarget>): ScopedFavorites => {
  if (items.length === 0) return favorites.filter((board) => !sameScope(board.scope, scope));
  if (!favorites.some((board) => sameScope(board.scope, scope))) return [...favorites, { scope, items }];
  return favorites.map((board) => (sameScope(board.scope, scope) ? { scope, items } : board));
};

/** Adds a target to a scope's board (at the end), or takes it out when it is
 * already there. */
export const toggled = (favorites: ScopedFavorites, scope: Scope, target: FavoriteTarget): ScopedFavorites => {
  const items = boardItems(favorites, scope);
  const next = items.some((each) => sameTarget(each, target))
    ? items.filter((each) => !sameTarget(each, target))
    : [...items, target];
  return withBoard(favorites, scope, next);
};

/** Replaces a scope's order (for drag; the edit-mode phase). */
export const reordered = (favorites: ScopedFavorites, scope: Scope, items: ReadonlyArray<FavoriteTarget>): ScopedFavorites =>
  withBoard(favorites, scope, items);

// --- Legacy migration. The previous favorites were a flat, Home-only list of
// sessions and repos. Read once (Favorites.ts) to fold into the home board,
// then discarded. Do not use elsewhere. ---

export const LegacyFavorite = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("session"),
    id: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("repo"),
    name: Schema.String,
  }),
]);

export const LegacyFavorites = Schema.Array(LegacyFavorite);
export type LegacyFavorites = typeof LegacyFavorites.Type;

/** The legacy flat favorites as a home board (empty in → empty out). */
export const fromLegacy = (legacy: LegacyFavorites): ScopedFavorites => {
  const items = legacy.map((favorite): FavoriteTarget => (favorite.kind === "session" ? sessionTarget(favorite.id) : repoTarget(favorite.name)));
  return items.length === 0 ? [] : [{ scope: homeScope, items }];
};
