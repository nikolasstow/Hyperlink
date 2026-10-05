/**
 * Home's favorites for React (Favorites.ts): `startFavorites` (once, at
 * launch) reads them back; Home draws them, and the session and repo cards'
 * menus add and take them out.
 *
 * @internal
 */
import { Effect, Stream } from "effect";
import * as React from "react";
import { forkApp, runApp } from "../effect/runtime";
import { Favorites, favoritesChanges } from "./Favorites";
import type { Favorite, Favorites as FavoriteList } from "./model";

let favorites: FavoriteList = [];
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

/** The favorites, in the order they were added. */
export const useFavorites = (): FavoriteList => React.useSyncExternalStore(subscribe, () => favorites);

/** Adds a favorite, or takes it out when it is one. */
export const toggleFavorite = (favorite: Favorite): Promise<void> =>
  runApp(
    Effect.gen(function* () {
      const store = yield* Favorites;
      yield* store.toggle(favorite);
    }),
  );
