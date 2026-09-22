/**
 * An animated bottom offset that rides the keyboard, for a bar floating at the
 * bottom edge (the composer, the search pill).
 *
 * It rests at `restingBottom` (the home-indicator safe-area inset) and animates
 * to the keyboard's height as the keyboard slides in — using the keyboard
 * event's OWN duration — then back down on hide. A view bound to it via
 * `{ bottom }` therefore tracks the keyboard instead of teleporting to the final
 * offset the instant `keyboardWillShow` fires.
 *
 * Why RN `Animated` and not `LayoutAnimation`: on the New Architecture (Fabric)
 * `LayoutAnimation` no-ops for a `bottom` change on an absolute view, so it
 * snapped. `Animated` with `useNativeDriver: false` drives the layout prop each
 * frame on the JS thread, which does animate. The consumer must be an
 * `Animated.View` (or `Animated.createAnimatedComponent`).
 *
 * Because the offset carries the safe area itself, the floating bar's own
 * bottom padding stays constant — no separate inset snap to reconcile.
 *
 * @internal
 */
import * as React from "react";
import { Animated, Easing, Keyboard } from "react-native";

export const useKeyboardOffset = (restingBottom: number): Animated.Value => {
  const value = React.useRef(new Animated.Value(restingBottom)).current;
  // Keep the latest resting value for the hide handler without re-subscribing.
  const resting = React.useRef(restingBottom);
  resting.current = restingBottom;

  React.useEffect(() => {
    const animate = (to: number, duration: number): void => {
      Animated.timing(value, {
        toValue: to,
        duration: duration > 0 ? duration : 250,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }).start();
    };
    const show = Keyboard.addListener("keyboardWillShow", (e) => animate(e.endCoordinates.height, e.duration));
    const hide = Keyboard.addListener("keyboardWillHide", (e) => animate(resting.current, e.duration));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [value]);

  return value;
};
