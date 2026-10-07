/**
 * The Files bottom bar's state-machine system: small, pure, total machines (one
 * per concern) that bind to React the same way (`useMachine`). The continuous
 * finger drag stays in Reanimated; these own the discrete state, the commit
 * decisions, and everything the UI derives — the single source of truth, so no
 * two flags can disagree.
 *
 * @internal
 */
export { type Bound, type Machine, type Motion, useMachine } from "./machine";
export * as Page from "./page";
export * as TabSwipe from "./tabSwipe";
