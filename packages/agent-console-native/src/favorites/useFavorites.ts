/**
 * Scoped favorites for React (Favorites.ts): `startFavorites` (once, at launch,
 * from index.ts) reads them back and mirrors them; each surface reads its own
 * board and favorites to its own scope.
 *
 * `useFavoriteScope` carries the scope of the surface a card sits on — a card's
 * Favorite action pins to *that* scope ("where you favorite from matters"). The
 * default is Home; repo/server screens provide their own.
 *
 * @internal
 */
import { Effect, Stream } from "effect";
import * as React from "react";
import { forkApp, runApp } from "../effect/runtime";
import { Favorites, favoritesChanges } from "./Favorites";
import { boardItems, type FavoriteTarget, homeScope, isFavorited, type Scope, type ScopedFavorites } from "./model";

let favorites: ScopedFavorites = [];
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

let started = false;
let readBack: () => void = () => undefined;
/** Settles once the favorites have been read back (Home draws them first). */
export const favoritesReadBack = new Promise<void>((resolve) => {
  readBack = resolve;
});

/** Reads back the favorites and mirrors them for React (once). */
export const startFavorites = (): void => {
  if (started) return;
  started = true;
  forkApp(
    favoritesChanges.pipe(
      Stream.runForEach((next) =>
        Effect.sync(() => {
          favorites = next;
          readBack();
          listeners.forEach((listener) => listener());
        }),
      ),
    ),
  );
};

/** Every board, as it changes. */
const useAllFavorites = (): ScopedFavorites => React.useSyncExternalStore(subscribe, () => favorites);

/** The targets pinned to a scope, in order. */
export const useBoard = (scope: Scope): ReadonlyArray<FavoriteTarget> => boardItems(useAllFavorites(), scope);

/** Whether a target is favorited in a scope. */
export const useIsFavorited = (scope: Scope, target: FavoriteTarget): boolean => isFavorited(useAllFavorites(), scope, target);

/** Adds a favorite to a scope, or takes it out when it is one. */
export const toggleFavorite = (scope: Scope, target: FavoriteTarget): Promise<void> =>
  runApp(
    Effect.gen(function* () {
      const store = yield* Favorites;
      yield* store.toggle(scope, target);
    }),
  );

/** The scope of the surface a card sits on; Favorite pins to this scope. */
const FavoriteScopeContext = React.createContext<Scope>(homeScope);

/** Wraps a surface so the cards inside favorite to its scope (repo/server
 * pages); Home needs no provider — the default is Home. */
export const FavoriteScopeProvider = FavoriteScopeContext.Provider;

export const useFavoriteScope = (): Scope => React.useContext(FavoriteScopeContext);
