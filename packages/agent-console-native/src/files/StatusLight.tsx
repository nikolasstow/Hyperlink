/**
 * The save indicator light: a small dot that pulses a colour on each save —
 * blue for a local (device) save, green for a cloud (disk) save — fed by the
 * flash queue (saveLight.ts) so it never flickers. Dim at rest.
 *
 * Prototype — colours, size, and the pulse are meant to be tweaked.
 *
 * @internal
 */
import * as React from "react";
import { StyleSheet } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { FLASH_COLOR, type SaveFlash } from "./saveLight";

const REST_COLOR = "rgba(142,147,163,0.5)";

export const StatusLight = (props: { readonly current: SaveFlash | null; readonly size?: number }): React.ReactElement => {
  const size = props.size ?? 9;
  const lit = useSharedValue(0);
  React.useEffect(() => {
    // Snap on, ease off — so each flash reads as a distinct pulse.
    lit.value = props.current === null ? withTiming(0, { duration: 260 }) : withTiming(1, { duration: 90 });
  }, [props.current, lit]);
  const style = useAnimatedStyle(() => ({ opacity: 0.35 + 0.65 * lit.value }));
  const color = props.current === null ? REST_COLOR : FLASH_COLOR[props.current];
  return <Animated.View style={[styles.dot, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
};

const styles = StyleSheet.create({
  dot: {
    alignSelf: "center",
  },
});
