/**
 * The between-tabs swipe, as its own machine (bar/machine.ts) so it can't
 * tangle with the Tabs↔Dubz page machine. The address pill is dragged left or
 * right; on release it either settles onto the neighbour tab or springs back.
 *
 * The commit decision (how far, or how fast, before it turns — and the clamp at
 * the first/last tab) lives HERE, once, totally tested — not scattered across
 * gesture handlers. The continuous finger position stays a Reanimated shared
 * value; this machine owns only the discrete state and the turn decision, and
 * tells the UI (via `view.commit`) which neighbour to select when the settle
 * animation lands.
 *
 * `swipe` runs + toward the previous tab, − toward the next (as the cards move).
 *
 * @internal
 */
import { Match } from "effect";
import { Animate, Drag, type Machine, type Motion } from "./machine";

export type TabSwipeMode =
  | { readonly _tag: "Idle" } // resting on a tab
  | { readonly _tag: "Dragging" } // a finger moving the cards
  | { readonly _tag: "Settling"; readonly delta: -1 | 1 }; // committed to the prev (−1) or next (+1) tab

export const Idle: TabSwipeMode = { _tag: "Idle" };
export const Dragging: TabSwipeMode = { _tag: "Dragging" };
export const Settling = (delta: -1 | 1): TabSwipeMode => ({ _tag: "Settling", delta });

export type TabSwipeEvent =
  | { readonly _tag: "DragStart" }
  // Let go at `swipe` (cards, + toward prev), rate `velocity`/s; whether a
  // neighbour exists to turn to.
  | { readonly _tag: "DragRelease"; readonly swipe: number; readonly velocity: number; readonly hasPrev: boolean; readonly hasNext: boolean }
  | { readonly _tag: "Settled" }; // the settle animation reached the neighbour

export const DragStart: TabSwipeEvent = { _tag: "DragStart" };
export const Settled: TabSwipeEvent = { _tag: "Settled" };
export const DragRelease = (swipe: number, velocity: number, hasPrev: boolean, hasNext: boolean): TabSwipeEvent => ({
  _tag: "DragRelease",
  swipe,
  velocity,
  hasPrev,
  hasNext,
});

/** Past a third of a card, or flung this fast (cards per second), it turns. */
const TURN = 0.33;
const FLING = 0.5;

const toPrev = (swipe: number, velocity: number): boolean => swipe > TURN || velocity > FLING;
const toNext = (swipe: number, velocity: number): boolean => swipe < -TURN || velocity < -FLING;

export const reduce = (mode: TabSwipeMode, event: TabSwipeEvent): TabSwipeMode =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      DragStart: () => (mode._tag === "Idle" ? Dragging : mode),
      DragRelease: ({ swipe, velocity, hasPrev, hasNext }) =>
        mode._tag === "Dragging"
          ? hasPrev && toPrev(swipe, velocity)
            ? Settling(-1)
            : hasNext && toNext(swipe, velocity)
              ? Settling(1)
              : Idle
          : mode,
      Settled: () => (mode._tag === "Settling" ? Idle : mode),
    }),
  );

export interface TabSwipeView {
  /** How the `swipe` shared value moves. */
  readonly swipe: Motion;
  /** The neighbour to select when a settle lands (−1 prev, +1 next); undefined
   * unless settling. */
  readonly commit: -1 | 1 | undefined;
  /** A swipe is in progress (dragging or settling) — gates other gestures. */
  readonly swiping: boolean;
}

export const view = (mode: TabSwipeMode): TabSwipeView =>
  Match.value(mode).pipe(
    Match.tagsExhaustive({
      Idle: (): TabSwipeView => ({ swipe: Animate(0), commit: undefined, swiping: false }),
      Dragging: (): TabSwipeView => ({ swipe: Drag, commit: undefined, swiping: true }),
      // Prev: cards slide right (swipe → +1); next: left (swipe → −1).
      Settling: ({ delta }): TabSwipeView => ({ swipe: Animate(delta === -1 ? 1 : -1), commit: delta, swiping: true }),
    }),
  );

export const checkInvariants = (mode: TabSwipeMode): void => {
  const v = view(mode);
  if ((v.swipe.kind === "drag") !== (mode._tag === "Dragging")) throw new Error(`[tabSwipe] swipe drags only while Dragging, mode is ${mode._tag}`);
  if ((v.commit !== undefined) !== (mode._tag === "Settling")) throw new Error(`[tabSwipe] commit is set only while Settling, mode is ${mode._tag}`);
};

/** The tab-swipe machine, ready to bind (bar/machine.ts). */
export const tabSwipe: Machine<TabSwipeMode, TabSwipeEvent, TabSwipeView> = {
  initial: Idle,
  reduce,
  view,
  invariants: checkInvariants,
};
