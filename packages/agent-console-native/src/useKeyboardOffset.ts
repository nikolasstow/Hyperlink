/**
 * A native-driven `translateY` that makes a bottom-anchored bar (the composer,
 * the search pill) ride the keyboard.
 *
 * The bar sits statically at `bottom: restingBottom` (the home-indicator safe-
 * area inset). This returns a `translateY` that is `0` at rest and animates
 * *up* by `keyboardHeight - restingBottom` as the keyboard slides in — using the
 * keyboard event's own duration — so the bar's visual bottom lands right on top
 * of the keyboard, then returns to `0` on hide.
 *
 * Why a `translateY` transform and not an animated `bottom`: transforms run on
 * the **native driver** (UI thread), so the slide is smooth. Animating a layout
 * prop like `bottom` forces `useNativeDriver: false`, which drives every frame
 * across the bridge on the JS thread and janks under the composer's glass/Host
 * relayout. `LayoutAnimation`, in turn, no-ops for this on the New Architecture.
 *
 * Apply it as `transform: [{ translateY }]` on an `Animated.View` whose `bottom`
 * is the static `restingBottom`. It composes with another native-driven
 * `translateY` (e.g. the search pill's scroll-hide) by stacking transform
 * entries.
 *
 * @internal
 */
import * as React from "react";
import { Animated, Easing, Keyboard } from "react-native";

export const useKeyboardOffset = (restingBottom: number): Animated.Value => {
  const translateY = React.useRef(new Animated.Value(0)).current;
  // Latest resting inset for the show handler, without re-subscribing.
  const resting = React.useRef(restingBottom);
  resting.current = restingBottom;

  React.useEffect(() => {
    const animate = (to: number, duration: number): void => {
      Animated.timing(translateY, {
        toValue: to,
        duration: duration > 0 ? duration : 250,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    };
    const show = Keyboard.addListener("keyboardWillShow", (e) =>
      // Negative = up. The keyboard height is measured from the screen bottom, so
      // subtracting the resting inset gives exactly how far to lift the bar.
      animate(-(e.endCoordinates.height - resting.current), e.duration),
    );
    const hide = Keyboard.addListener("keyboardWillHide", (e) => animate(0, e.duration));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [translateY]);

  return translateY;
};
