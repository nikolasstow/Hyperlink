/**
 * A bottom bar that leaves as you scroll down and comes back as you scroll
 * up (as Safari's, Files' and Mail's do). UIKit has no hook for a custom
 * bar, so the scroll direction is turned into a shared value here, animated
 * on the UI thread, for the bar to drop by (layout, never a transform: it is
 * glass). Shared by the search pill (BottomSearchPill.tsx) and Files' bar.
 *
 * @internal
 */
import * as React from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { Easing, type SharedValue, useSharedValue, withTiming } from "react-native-reanimated";

/** Ignore scroll jitter below this many points, so the bar does not flicker. */
const DIRECTION_THRESHOLD = 6;
/** Within this far of the top the bar is always shown. */
const TOP_ZONE = 4;

export interface ScrollHide {
  /** Hand to the scrolling list's `onScroll`. */
  readonly onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** How far the bar is pushed below its resting position (0 = shown). */
  readonly hidden: SharedValue<number>;
  /** Brings it back (a new page showing). */
  readonly show: () => void;
}

/** `distance`: how far past the bottom edge the bar travels when it hides. */
export const useScrollHide = (distance: number): ScrollHide => {
  const hidden = useSharedValue(0);
  const lastY = React.useRef(0);
  const isHidden = React.useRef(false);

  const setHidden = React.useCallback(
    (next: boolean): void => {
      if (isHidden.current === next) return;
      isHidden.current = next;
      // Curved, not linear: accelerate away on hide, ease back a touch slower.
      hidden.value = withTiming(next ? distance : 0, {
        duration: next ? 200 : 320,
        easing: next ? Easing.in(Easing.cubic) : Easing.out(Easing.cubic),
      });
    },
    [hidden, distance],
  );

  const onScroll = React.useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
      const y = event.nativeEvent.contentOffset.y;
      const dy = y - lastY.current;
      if (y <= TOP_ZONE) setHidden(false);
      else if (dy > DIRECTION_THRESHOLD) setHidden(true);
      else if (dy < -DIRECTION_THRESHOLD) setHidden(false);
      lastY.current = y;
    },
    [setHidden],
  );

  const show = React.useCallback((): void => {
    lastY.current = 0;
    setHidden(false);
  }, [setHidden]);

  return { onScroll, hidden, show };
};
