/**
 * The shape every bottom-bar machine takes, and the one hook that binds it to
 * React — so each concern (the Tabs↔Dubz page, the between-tabs swipe, …) is a
 * small, pure, total, independently-tested unit that plugs in the same way.
 *
 * A machine is pure data + functions: one tagged `Mode`, a `reduce` that
 * handles every event, a `view` that derives everything the UI needs, and
 * dev-only `invariants`. `useMachine` runs it on a synchronous `useReducer`
 * (the right tool for gesture-driven state — no async, no Effect runtime in
 * the hot path), memoises the view per mode, and asserts the invariants in
 * development.
 *
 * @internal
 */
import * as React from "react";

/** How a Reanimated shared value moves now: the finger drives it (`drag`), or
 * it animates to a target. The bridge reads this from a machine's view. */
export type Motion = { readonly kind: "drag" } | { readonly kind: "animate"; readonly to: number };
export const Drag: Motion = { kind: "drag" };
export const Animate = (to: number): Motion => ({ kind: "animate", to });

export interface Machine<Mode, Event, View> {
  readonly initial: Mode;
  /** Total: handles every event; one that doesn't apply returns `mode`. */
  readonly reduce: (mode: Mode, event: Event) => Mode;
  /** Everything the UI needs, derived from the mode alone. */
  readonly view: (mode: Mode) => View;
  /** Checked in development after each transition; throws on a broken one. */
  readonly invariants?: (mode: Mode) => void;
}

export interface Bound<Mode, Event, View> {
  readonly mode: Mode;
  readonly view: View;
  readonly dispatch: (event: Event) => void;
}

export const useMachine = <Mode, Event, View>(machine: Machine<Mode, Event, View>): Bound<Mode, Event, View> => {
  const step = React.useCallback(
    (mode: Mode, event: Event): Mode => {
      const next = machine.reduce(mode, event);
      if (__DEV__ && machine.invariants !== undefined) machine.invariants(next);
      return next;
    },
    [machine],
  );
  const [mode, dispatch] = React.useReducer(step, machine.initial);
  const view = React.useMemo(() => machine.view(mode), [machine, mode]);
  return { mode, view, dispatch };
};
