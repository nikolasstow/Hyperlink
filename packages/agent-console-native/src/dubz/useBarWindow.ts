/**
 * The bar window's settled state for React (BarWindowStore.ts): `startBarWindow`
 * (once, at launch) mirrors the route→state map; `useBarCover` turns this
 * screen's own route into the points its scroll views pad their bottom by;
 * BarWindow reports and forgets through `settleBarWindow` / `forgetBarWindow`;
 * the Dubz detent memory is read and kept through `readDubzDetent` /
 * `saveDubzDetent`.
 *
 * Follows useHomeLayout: a module mirror of the store's changes, exposed to
 * React with useSyncExternalStore.
 *
 * @internal
 */
import { useHeaderHeight } from "@react-navigation/elements";
import { useRoute } from "@react-navigation/native";
import { Effect, Stream } from "effect";
import * as React from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { forkApp, runApp } from "../effect/runtime";
import { type BarWindowState, coverOf, type ScreenFrame } from "./barWindowGeometry";
import { barWindowChanges, BarWindowStore, type DubzDetent } from "./BarWindowStore";

let states: ReadonlyMap<string, BarWindowState> = new Map();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

let started = false;
/** Mirrors the store's route→state map for React (once, at launch). */
export const startBarWindow = (): void => {
  if (started) return;
  started = true;
  forkApp(
    barWindowChanges.pipe(
      Stream.runForEach((next) =>
        Effect.sync(() => {
          states = next;
          listeners.forEach((listener) => listener());
        }),
      ),
    ),
  );
};

const useStates = (): ReadonlyMap<string, BarWindowState> => React.useSyncExternalStore(subscribe, () => states);

/** The collapsed pill — what a route with no settled window covers. */
const COLLAPSED: BarWindowState = { open: false, frac: 0, kbFull: 0, keyboard: 0 };

/** The points this screen should pad its scroll bottom by: its own route's
 * settled bar window through coverOf, or the collapsed pill when it has none.
 * Derived at read time from the state and the screen frame — never stored. */
export const useBarCover = (): number => {
  const map = useStates();
  const routeKey = useRoute().key;
  const { height } = useWindowDimensions();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const frame: ScreenFrame = { height, headerHeight, insetTop: insets.top, insetBottom: insets.bottom };
  return coverOf(map.get(routeKey) ?? COLLAPSED, frame);
};

/** BarWindow keeps a route's settled window (on open, close, snap, keyboard). */
export const settleBarWindow = (routeKey: string, state: BarWindowState): void => {
  void runApp(
    Effect.gen(function* () {
      yield* (yield* BarWindowStore).settle(routeKey, state);
    }),
  );
};

/** BarWindow drops its route on unmount. */
export const forgetBarWindow = (routeKey: string): void => {
  void runApp(
    Effect.gen(function* () {
      yield* (yield* BarWindowStore).forget(routeKey);
    }),
  );
};

/** The detent the Dubz window was last left at (replaces getDubzDetent). */
export const readDubzDetent = (): Promise<DubzDetent | undefined> =>
  runApp(
    Effect.gen(function* () {
      return yield* (yield* BarWindowStore).detent.get;
    }),
  );

/** Keep the detent the Dubz window was just left at (replaces setDubzDetent). */
export const saveDubzDetent = (detent: DubzDetent): Promise<void> =>
  runApp(
    Effect.gen(function* () {
      yield* (yield* BarWindowStore).detent.set(detent);
    }),
  );
