/**
 * The Files bottom bar's state machine: the single source of truth for whether
 * it shows the tabs nav or Dubz, and every transition between them — tap,
 * swipe open, swipe back, and Dubz closing itself.
 *
 * It is pure and TOTAL: `Match.tagsExhaustive` forces every event to be handled
 * (a compile error otherwise), an event that doesn't apply leaves the mode
 * unchanged (never a throw), and the mode is ONE tagged value — so the bar
 * can't land in a contradictory combination of booleans, the class of bug that
 * made Dubz open then immediately close. Everything the UI needs is DERIVED
 * from the mode by `barView`; nothing is stored twice.
 *
 * The continuous finger drag is deliberately NOT modelled here: that stays a
 * Reanimated shared value on the UI thread (per-frame, fast). `barView` says
 * when the gesture drives `pageX` (`drag`) versus when it animates to a target
 * (`animate`). This machine owns only the discrete state and the commit
 * decision.
 *
 * @internal
 */
import { Match } from "effect";

/** How the bar stands. `pageX` runs 0 (the tabs nav) → 1 (Dubz). The modes
 * carry no data, so each is a single value. */
export type BarMode =
  | { readonly _tag: "Tabs" } // resting on the tabs nav
  | { readonly _tag: "DraggingToDubz" } // a finger dragging the chat button toward Dubz
  | { readonly _tag: "Opening" } // committed to Dubz; pageX animating to 1, window still collapsed
  | { readonly _tag: "Dubz" } // Dubz is the page; its window is open (detents owned by BarWindow)
  | { readonly _tag: "DraggingToTabs" } // a finger dragging Dubz back (window still open)
  | { readonly _tag: "Closing" }; // committed back to the tabs nav; pageX animating to 0, window collapsed

export const Tabs: BarMode = { _tag: "Tabs" };
export const DraggingToDubz: BarMode = { _tag: "DraggingToDubz" };
export const Opening: BarMode = { _tag: "Opening" };
export const Dubz: BarMode = { _tag: "Dubz" };
export const DraggingToTabs: BarMode = { _tag: "DraggingToTabs" };
export const Closing: BarMode = { _tag: "Closing" };

/** Why Dubz closed itself (BarWindow). */
export type DubzCloseReason = "keyboard" | "dismiss";

/**
 * What happens to the bar. A gesture or BarWindow emits one; the machine is the
 * only writer of the mode.
 */
export type BarEvent =
  | { readonly _tag: "TapDubz" } // tapped the chat button
  | { readonly _tag: "DragStart" } // a drag began (its direction is implied by the mode)
  | { readonly _tag: "DragRelease"; readonly progress: number; readonly velocity: number } // let go at pageX `progress`, rate `velocity`/s (+ toward Dubz)
  | { readonly _tag: "Settled" } // a commit animation reached its target
  | { readonly _tag: "DubzClosed"; readonly reason: DubzCloseReason }; // the window closed itself

export const TapDubz: BarEvent = { _tag: "TapDubz" };
export const DragStart: BarEvent = { _tag: "DragStart" };
export const Settled: BarEvent = { _tag: "Settled" };
export const DragRelease = (progress: number, velocity: number): BarEvent => ({ _tag: "DragRelease", progress, velocity });
export const DubzClosed = (reason: DubzCloseReason): BarEvent => ({ _tag: "DubzClosed", reason });

/** Past this much of the way, or flung at least this fast (pageX per second), a
 * drag commits rather than springing back. */
const OPEN_TURN = 0.2;
const CLOSE_TURN = 0.8;
const FLING = 0.8;

const opens = (progress: number, velocity: number): boolean => progress > OPEN_TURN || velocity > FLING;
const closes = (progress: number, velocity: number): boolean => progress < CLOSE_TURN || velocity < -FLING;

/** The next mode for an event — total; an event that doesn't apply in the
 * current mode leaves it unchanged. */
export const reduce = (mode: BarMode, event: BarEvent): BarMode =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      TapDubz: () => (mode._tag === "Tabs" ? Opening : mode),
      DragStart: () => (mode._tag === "Tabs" ? DraggingToDubz : mode._tag === "Dubz" ? DraggingToTabs : mode),
      DragRelease: ({ progress, velocity }) =>
        mode._tag === "DraggingToDubz"
          ? // Opened enough → finish opening; else slide back to the tabs nav.
            opens(progress, velocity)
            ? Opening
            : Closing
          : mode._tag === "DraggingToTabs"
            ? // Dragged back enough → finish closing; else spring back to Dubz
              // (the window stayed open throughout, so no flicker).
              closes(progress, velocity)
              ? Closing
              : Dubz
            : mode,
      Settled: () => (mode._tag === "Opening" ? Dubz : mode._tag === "Closing" ? Tabs : mode),
      // The window decided to close: slide out from wherever in Dubz territory.
      DubzClosed: () => (mode._tag === "Dubz" || mode._tag === "Opening" || mode._tag === "DraggingToTabs" ? Closing : mode),
    }),
  );

/** How `pageX` behaves now: the finger drives it, or it animates to a target. */
export type PageX = { readonly kind: "drag" } | { readonly kind: "animate"; readonly to: number };

/** Everything the bar's UI needs, DERIVED from the mode — the only place these
 * are decided, so they can never disagree with each other. */
export interface BarView {
  /** How pageX moves. */
  readonly pageX: PageX;
  /** BarWindow's `open` prop (the window grown to a detent, not the slide). */
  readonly dubzOpen: boolean;
  /** The tabs nav takes touches (only at rest on it). */
  readonly barInteractive: boolean;
  /** Dubz's page takes touches (only while it is the page). */
  readonly dubzInteractive: boolean;
}

const animate = (to: number): PageX => ({ kind: "animate", to });
const dragPageX: PageX = { kind: "drag" };

export const barView = (mode: BarMode): BarView =>
  Match.value(mode).pipe(
    Match.tagsExhaustive({
      Tabs: (): BarView => ({ pageX: animate(0), dubzOpen: false, barInteractive: true, dubzInteractive: false }),
      DraggingToDubz: (): BarView => ({ pageX: dragPageX, dubzOpen: false, barInteractive: false, dubzInteractive: false }),
      Opening: (): BarView => ({ pageX: animate(1), dubzOpen: false, barInteractive: false, dubzInteractive: false }),
      Dubz: (): BarView => ({ pageX: animate(1), dubzOpen: true, barInteractive: false, dubzInteractive: true }),
      DraggingToTabs: (): BarView => ({ pageX: dragPageX, dubzOpen: true, barInteractive: false, dubzInteractive: true }),
      Closing: (): BarView => ({ pageX: animate(0), dubzOpen: false, barInteractive: false, dubzInteractive: false }),
    }),
  );

/** Dev-only sanity on a mode's derived view: the bar and Dubz are never both
 * live, and the window is open exactly in Dubz territory. Throws if violated
 * (the caller runs it in development after each transition). */
export const checkInvariants = (mode: BarMode): void => {
  const view = barView(mode);
  if (view.barInteractive && view.dubzInteractive) throw new Error(`[barMachine] bar and Dubz both interactive in ${mode._tag}`);
  const dubzTerritory = mode._tag === "Dubz" || mode._tag === "DraggingToTabs";
  if (view.dubzOpen !== dubzTerritory) throw new Error(`[barMachine] dubzOpen=${view.dubzOpen} but mode is ${mode._tag}`);
};
