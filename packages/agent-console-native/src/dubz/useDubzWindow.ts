/**
 * The Dubz window's coordinator for one screen. The rules are the pure reducer
 * (dubzWindowMachine.ts); this holds the state for React, logs EVERY transition
 * through the Effect runtime (so the sequence that caused a glitch shows up in
 * Metro as `[dubz] …`), and persists the default height when a drag sets it.
 *
 * Per-screen, not a global singleton: each screen's bar has its own window
 * state, so a background screen's bar can never clobber the foreground one.
 * Transitions are discrete (a handful per interaction), never per frame, so the
 * Effect round-trip for the log never touches the animation hot path.
 *
 * @internal
 */
import * as React from "react";
import { type DubzWindowEvent, type DubzWindowState, initialDubzWindowState, reduceDubzWindow, requestedHeightOf } from "./dubzWindowMachine";
import { saveDubzDefaultHeight } from "./useBarWindow";

/** Log a transition. Discrete, never per frame. console.log (not Effect.logDebug)
 * so it is actually visible in Metro while we debug the window behaviour. */
const h = (n: number | undefined): string => (n === undefined ? "-" : String(Math.round(n)));
const logTransition = (routeKey: string, event: DubzWindowEvent, prev: DubzWindowState, next: DubzWindowState): void => {
  const show = (s: DubzWindowState): string => `${s.phase}/${s.keyboard} def=${h(s.defaultHeight)} act=${h(s.activeHeight)}${s.pinned ? " PIN" : ""} c=${s.compact ? 1 : 0}${s.compactContent ? "/cc" : ""}`;
  console.log(`[dubz] ${routeKey} ${event._tag}: ${show(prev)} → ${show(next)} req=${h(requestedHeightOf(next))}`);
};

export interface DubzWindow {
  readonly state: DubzWindowState;
  readonly dispatch: (event: DubzWindowEvent) => void;
}

/** `initialDefault` seeds the remembered height — the persisted default, or the
 * single-suggestion min before the user has ever dragged. */
export const useDubzWindow = (routeKey: string, initialDefault: number): DubzWindow => {
  const [state, setState] = React.useState(() => initialDubzWindowState(initialDefault));
  // The live state for the dispatcher, so it can read the current value without
  // being rebuilt each change (the dispatch identity stays stable).
  const current = React.useRef(state);
  current.current = state;
  const dispatch = React.useCallback(
    (event: DubzWindowEvent): void => {
      const prev = current.current;
      const next = reduceDubzWindow(prev, event);
      if (next === prev) return;
      current.current = next;
      logTransition(routeKey, event, prev, next);
      if (event._tag === "heightSettled") void saveDubzDefaultHeight(next.defaultHeight);
      setState(next);
    },
    [routeKey],
  );
  return { state, dispatch };
};
