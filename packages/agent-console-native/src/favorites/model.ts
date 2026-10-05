/**
 * Favorites: sessions and repos (or workspaces) pinned to the top of Home, in
 * the order they were added.
 *
 * @internal
 */
import { Schema } from "effect";

export const FavoriteSession = Schema.Struct({
  kind: Schema.Literal("session"),
  id: Schema.String,
});

/** A repo or a workspace, by its name on Home. */
export const FavoriteRepo = Schema.Struct({
  kind: Schema.Literal("repo"),
  name: Schema.String,
});

export const Favorite = Schema.Union([FavoriteSession, FavoriteRepo]);
export type Favorite = typeof Favorite.Type;

export const Favorites = Schema.Array(Favorite);
export type Favorites = typeof Favorites.Type;

export const favoriteSession = (id: string): Favorite => ({ kind: "session", id });
export const favoriteRepo = (name: string): Favorite => ({ kind: "repo", name });

const same = (a: Favorite, b: Favorite): boolean =>
  a.kind === "session" ? b.kind === "session" && a.id === b.id : b.kind === "repo" && a.name === b.name;

export const isFavorite = (favorites: Favorites, favorite: Favorite): boolean => favorites.some((each) => same(each, favorite));

/** Added at the end, or taken out when it is there. */
export const toggled = (favorites: Favorites, favorite: Favorite): Favorites =>
  isFavorite(favorites, favorite) ? favorites.filter((each) => !same(each, favorite)) : [...favorites, favorite];
