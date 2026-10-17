/**
 * DEV debug overlay for the Dubz window (toggle `DUBZ_DEBUG` in Dubz.tsx). Draws
 * borders on the content region and the top bar, colours the content differently
 * when compact, and reads out the live window height and the composer floor — so
 * the height behaviour can be followed on device. pointerEvents="none" (never
 * blocks touches); off in production (flag false).
 *
 * @internal
 */
import * as React from "react";
import { StyleSheet, Text, View } from "react-native";
import { runOnJS, useAnimatedReaction, type SharedValue } from "react-native-reanimated";
import { BarWindowHeightContext } from "../BarWindow";
import { DUBZ_TOP_BAR } from "./DubzSessions";

export const DubzDebug = (props: { readonly composerFloor: SharedValue<number>; readonly compact: boolean }): React.ReactElement => {
  const visible = React.useContext(BarWindowHeightContext);
  const [winH, setWinH] = React.useState(0);
  const [floorH, setFloorH] = React.useState(0);
  useAnimatedReaction(
    () => (visible === undefined ? 0 : Math.round(visible.value)),
    (now, prev) => {
      if (now !== prev) runOnJS(setWinH)(now);
    },
    [visible],
  );
  useAnimatedReaction(
    () => Math.round(props.composerFloor.value),
    (now, prev) => {
      if (now !== prev) runOnJS(setFloorH)(now);
    },
    [],
  );
  const regionColor = props.compact ? "#f59e0b" : "#22c55e"; // orange compact, green normal
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* The actual content area: below the top bar, down to the body's bottom
       * (which is the composer pill's top — so it shrinks as the input grows).
       * Coloured by compact state. */}
      <View style={{ position: "absolute", top: DUBZ_TOP_BAR, left: 0, right: 0, bottom: 0, borderWidth: 1, borderColor: regionColor }} />
      {/* The top bar the content reserves above it (the back button + gap). */}
      <View style={[styles.topBar, { height: DUBZ_TOP_BAR }]} />
      {/* Live sizes. */}
      <View style={styles.readout}>
        <Text style={[styles.text, { color: regionColor }]}>
          win {winH} · floor {floorH} · {props.compact ? "COMPACT" : "normal"}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  topBar: { position: "absolute", top: 0, left: 0, right: 0, borderBottomWidth: 1, borderColor: "#ef4444" },
  readout: { position: "absolute", top: 3, alignSelf: "center", backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  text: { fontSize: 12, fontWeight: "700", fontFamily: "Menlo" },
});
