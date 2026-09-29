/**
 * A full-screen tap catcher shown while the keyboard is up. The first tap
 * anywhere outside the composer is *consumed* and only dismisses the keyboard
 * (collapsing the composer) — instead of falling through to a list row or
 * button and navigating away when the user just wanted to collapse.
 *
 * With `dim`, it also dims the page behind the composer while it is open (the
 * new-session composer's clear glass reads against a darker page), fading in
 * and out with it. The fade is the scrim's own, beside the composer's glass,
 * never around it (fading a parent of glass stops it rendering as glass).
 *
 * Place it directly below the (absolutely-positioned) composer in the screen
 * tree so the composer's own controls stay on top and tappable, while
 * everything behind it is covered.
 *
 * @internal
 */
import * as React from "react";
import { Keyboard, Pressable, StyleSheet } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

/** How dark the page gets behind the open composer, and how fast. */
const DIM_OPACITY = 0.35;
const DIM_MS = 220;

export const KeyboardDismissOverlay = (props: { readonly active: boolean; readonly dim?: boolean }): React.ReactElement | null => {
  const shade = useSharedValue(0);
  const dim = props.dim === true;
  React.useEffect(() => {
    if (dim) shade.value = withTiming(props.active ? DIM_OPACITY : 0, { duration: DIM_MS });
  }, [dim, props.active, shade]);
  const scrim = useAnimatedStyle(() => ({ opacity: shade.value }));

  return (
    <>
      {/* Always there when dimming, so it can fade out as well as in; it only
       * catches touches while active. */}
      {dim ? <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrim]} pointerEvents="none" /> : null}
      {props.active ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => Keyboard.dismiss()}
          accessible={false}
          // A dismiss gesture, not a control — keep it out of the a11y tree.
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}
    </>
  );
};

const styles = StyleSheet.create({
  scrim: {
    backgroundColor: "#000000",
  },
});
