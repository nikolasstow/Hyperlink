/**
 * A reanimated style that makes a bottom-anchored bar ride the keyboard EXACTLY.
 *
 * `useAnimatedKeyboard` reads the real keyboard position every frame on the UI
 * thread, so the bar follows the keyboard's own curve and timing — not a
 * duration/easing approximation (which is what made the RN `Animated` version
 * smooth-but-out-of-sync).
 *
 * It animates the layout prop `bottom` (from `restingBottom`, the home-indicator
 * safe-area inset, up to the keyboard height) rather than a `transform`. Two
 * reasons: it needs no static `bottom` to sit on, and — the important one — a
 * `transform` composites the whole bar into one layer, under which the native
 * `@expo/ui` `Host` buttons mis-measured on first mount (visible as the row's
 * buttons drifting out of vertical alignment until an app background/foreground
 * re-initialised them). Animating `bottom` keeps the buttons in the normal
 * layout flow. Still reanimated, so still UI-thread smooth.
 *
 * Apply it as a style on a reanimated `Animated.View`; it composes with a
 * nested RN-`Animated` transform (the search pill's scroll-hide) by nesting the
 * two views, not mixing the two systems on one node.
 *
 * @internal
 */
import { useAnimatedKeyboard, useAnimatedStyle, type AnimatedStyle } from "react-native-reanimated";
import type { ViewStyle } from "react-native";

export const useKeyboardSlide = (restingBottom: number): AnimatedStyle<ViewStyle> => {
  const keyboard = useAnimatedKeyboard();
  return useAnimatedStyle(() => ({
    bottom: Math.max(keyboard.height.value, restingBottom),
  }));
};
