/**
 * The breadcrumbs' scopes change as if the glass were a drum turning: the
 * crumbs leaving roll off one edge, fading, and the new ones roll on from the
 * other, the way the line moved — on down the file, the drum turns up (out
 * over the top, in from below); back up, it turns down.
 *
 * The direction is a shared value read when each animation starts, so a crumb
 * leaving rolls the way of the change that removed it.
 *
 * @internal
 */
import { type EntryExitAnimationFunction, type SharedValue, withTiming } from "react-native-reanimated";

/** How far a crumb travels on and off, how much it tilts, and the depth. */
const ROLL = 16;
const TILT = 55;
const PERSPECTIVE = 300;
const timing = { duration: 220 };

/** 1: the line moved on down the file; -1: back up. */
export type RollDirection = 1 | -1;

/** A new scope rolling on: from below going down the file, above going up. */
export const rollIn =
  (direction: SharedValue<RollDirection>): EntryExitAnimationFunction =>
  () => {
    "worklet";
    const from = direction.value * ROLL;
    return {
      initialValues: {
        opacity: 0,
        transform: [{ perspective: PERSPECTIVE }, { translateY: from }, { rotateX: `${-direction.value * TILT}deg` }],
      },
      animations: {
        opacity: withTiming(1, timing),
        transform: [{ perspective: withTiming(PERSPECTIVE, timing) }, { translateY: withTiming(0, timing) }, { rotateX: withTiming("0deg", timing) }],
      },
    };
  };

/** A scope rolling off: over the top going down the file, under going up. */
export const rollOut =
  (direction: SharedValue<RollDirection>): EntryExitAnimationFunction =>
  () => {
    "worklet";
    const to = -direction.value * ROLL;
    return {
      initialValues: {
        opacity: 1,
        transform: [{ perspective: PERSPECTIVE }, { translateY: 0 }, { rotateX: "0deg" }],
      },
      animations: {
        opacity: withTiming(0, timing),
        transform: [{ perspective: withTiming(PERSPECTIVE, timing) }, { translateY: withTiming(to, timing) }, { rotateX: withTiming(`${direction.value * TILT}deg`, timing) }],
      },
    };
  };
