/**
 * The Dubz window's discrete state, as a pure reducer — the single source of
 * truth for how the window, the keyboard and an active component coordinate.
 * The coordinator store (DubzWindowStore.ts) runs this inside Effect and logs
 * every transition, so the sequence that caused a glitch is visible in Metro.
 *
 * Why a reducer: the coordination was spread across several callbacks in
 * BarWindow that disagreed (a frozen keyboard max, a settled-keyboard report
 * that lagged the live value, focus/blur not reconciled against intent), which
 * is what let the window stay up after the keyboard went, and reappear after a
 * dismiss. Here the rules are data, and the bad transitions are the ones the
 * reducer simply cannot produce.
 *
 * The height model (barWindowGeometry.ts owns the math):
 * - `defaultHeight` is the user's remembered height. A drag sets it.
 * - `activeHeight` is an active component's height, when one is active.
 * - The REQUESTED height is the active height when it is taller than the
 *   default, else the default. The keyboard never changes it — only the clamp
 *   the renderer applies (barWindowGeometry.clampRequested).
 *
 * @internal
 */

/** Why the window closed. All of them are terminal: once closed, nothing but an
 * explicit open reopens it (so a late keyboard or focus event can't resurrect
 * it — the dismiss bug). */
export type CloseReason = "dismiss" | "swipeBack" | "back" | "keyboard";

/** The window's settled discrete state. */
export interface DubzWindowState {
  readonly phase: "closed" | "open";
  /** The keyboard as last tracked — intent, not a per-frame height. */
  readonly keyboard: "down" | "up";
  /** The user's remembered height (the default requested height). */
  readonly defaultHeight: number;
  /** An active component's height, or undefined when none is active. */
  readonly activeHeight: number | undefined;
  /** Whether the user has dragged to a height, pinning it OVER an active
   * component's claim. A drag pins; a (re)activation or deactivation clears it.
   * Without this, an active, taller component snaps the window back up after a
   * drag and compact can never be reached. */
  readonly pinned: boolean;
  /** The display mode, from the live visible height (dubzLayout): whether Dubz
   * is compact, and whether the content must shift aside for the top-left
   * buttons. A height reaction keeps these up to date; they are not per-frame
   * state (they flip only on a threshold crossing). */
  readonly compact: boolean;
  readonly compactContent: boolean;
}

/** What happens to the window. */
export type DubzWindowEvent =
  | { readonly _tag: "openRequested" }
  | { readonly _tag: "closeRequested"; readonly reason: CloseReason }
  | { readonly _tag: "keyboardShown" }
  | { readonly _tag: "keyboardHidden" }
  /** A drag released; the user set a new default height. */
  | { readonly _tag: "heightSettled"; readonly height: number }
  | { readonly _tag: "componentActivated"; readonly height: number }
  | { readonly _tag: "componentHeightChanged"; readonly height: number }
  | { readonly _tag: "componentDeactivated" }
  | { readonly _tag: "layoutChanged"; readonly compact: boolean; readonly compactContent: boolean };

/** The initial state: closed, keyboard down, at a remembered default. */
export const initialDubzWindowState = (defaultHeight: number): DubzWindowState => ({
  phase: "closed",
  keyboard: "down",
  defaultHeight,
  activeHeight: undefined,
  pinned: false,
  compact: false,
  compactContent: false,
});

/** The requested height: the user's pinned height when they have dragged one,
 * else the active component's height when it is taller than the default, else
 * the default. The keyboard is not part of this — the renderer clamps it per
 * frame. */
export const requestedHeightOf = (state: DubzWindowState): number =>
  state.pinned
    ? state.defaultHeight
    : state.activeHeight !== undefined && state.activeHeight > state.defaultHeight
      ? state.activeHeight
      : state.defaultHeight;

/** The reducer: pure, total, and the only place the rules live. */
export const reduceDubzWindow = (state: DubzWindowState, event: DubzWindowEvent): DubzWindowState => {
  switch (event._tag) {
    case "openRequested":
      // The one way into `open`. Opening never raises the keyboard itself
      // (Dubz opens to its suggestions); a tap on the field does that.
      return state.phase === "open" ? state : { ...state, phase: "open" };
    case "closeRequested":
      // Terminal: closed stays closed until an explicit open. The keyboard is
      // left as tracked; it animates down on its own. The display mode resets —
      // the height reaction sets it again on the next open.
      return state.phase === "closed" ? state : { ...state, phase: "closed", compact: false, compactContent: false };
    case "keyboardShown":
      // Tracked whether open or closed; it never opens the window and never
      // changes the requested height.
      return state.keyboard === "up" ? state : { ...state, keyboard: "up" };
    case "keyboardHidden":
      // The keyboard going down does NOT close the window; closing is explicit.
      return state.keyboard === "down" ? state : { ...state, keyboard: "down" };
    case "heightSettled":
      // A drag sets the new default AND pins it — the user's drag wins and
      // sticks, over any active component's claim (this is how compact is
      // reached). Ignored while closed (there is nothing to size).
      return state.phase === "closed" || (state.defaultHeight === event.height && state.pinned) ? state : { ...state, defaultHeight: event.height, pinned: true };
    case "componentActivated":
      // A (re)activation takes over the sizing — it clears a pin, so a freshly
      // expanded component grows the window to show itself.
      return state.activeHeight === event.height ? state : { ...state, activeHeight: event.height, pinned: false };
    case "componentHeightChanged":
      // Only meaningful while a component is active. The active height changed,
      // so the calculation reruns — which clears any user pin: a user-set height
      // stays only UNTIL the active height changes.
      return state.activeHeight === undefined || state.activeHeight === event.height ? state : { ...state, activeHeight: event.height, pinned: false };
    case "componentDeactivated":
      // Back to the default (unpinned) on the next calculation.
      return state.activeHeight === undefined ? state : { ...state, activeHeight: undefined, pinned: false };
    case "layoutChanged":
      // The display mode, from the height reaction (dubzLayout). A discrete flip
      // on a threshold crossing, not per-frame.
      return state.compact === event.compact && state.compactContent === event.compactContent
        ? state
        : { ...state, compact: event.compact, compactContent: event.compactContent };
  }
};
