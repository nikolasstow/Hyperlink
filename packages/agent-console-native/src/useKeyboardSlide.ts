/**
 * A reanimated style that makes a bottom-anchored bar ride the keyboard EXACTLY.
 *
 * The bar sits statically at `bottom: restingBottom` (the home-indicator safe-
 * area inset). `useAnimatedKeyboard` reads the real keyboard position every
 * frame on the UI thread, so the returned `translateY` follows the keyboard's
 * own curve and timing — not a duration/easing approximation, which is what
 * made the RN `Animated` version smooth-but-out-of-sync. It lifts the bar by
 * `keyboardHeight - restingBottom` (clamped at 0 so it never dips below rest).
 *
 * Apply it as one of the styles on a reanimated `Animated.View`. It composes
 * with a nested RN-`Animated` transform (the search pill's scroll-hide) by
 * nesting the two views rather than mixing the two animation systems on one.
 *
 * @internal
 */
import { useAnimatedKeyboard, useAnimatedStyle, type AnimatedStyle } from "react-native-reanimated";
import type { ViewStyle } from "react-native";

export const useKeyboardSlide = (restingBottom: number): AnimatedStyle<ViewStyle> => {
  const keyboard = useAnimatedKeyboard();
  return useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(keyboard.height.value - restingBottom, 0) }],
  }));
};
