/**
 * DEV probe for the height model. Toggle `DUBZ_PROBE` in Dubz.tsx to swap the
 * home suggestions for this. It stands in as an "active component" (a block of
 * exactly its claimed height — cycle it by tapping anywhere), and shows the
 * model's math as the literal EQUATIONS, substituted with live numbers — so you
 * can see, e.g., the compact viewport drop the top bar.
 *
 * @internal
 */
import * as React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { runOnJS, useAnimatedReaction } from "react-native-reanimated";
import { BarWindowHeightContext } from "../BarWindow";
import { COMPACT_ZONE_MAX, contentViewport, isCompact } from "./dubzLayout";
import { DUBZ_BOTTOM_BAR, DUBZ_TOP_BAR, SINGLE_SUGGESTION_HEIGHT } from "./DubzSessions";
import { requestedHeightOf, type DubzWindowState } from "./dubzWindowMachine";

/** Heights to cycle: the min, up through the compact-zone edge, and above it. */
const PROBE_HEIGHTS: ReadonlyArray<number> = [SINGLE_SUGGESTION_HEIGHT, 180, 240, 300, COMPACT_ZONE_MAX, 360, 440, 560];

export const DubzActiveProbe = (props: {
  readonly state: DubzWindowState;
  readonly onActiveHeight?: (height: number | undefined) => void;
}): React.ReactElement => {
  const [index, setIndex] = React.useState(0);
  const height = PROBE_HEIGHTS[index] ?? SINGLE_SUGGESTION_HEIGHT;
  // Report through a ref so the identity stays stable; deactivate on unmount.
  const report = React.useRef(props.onActiveHeight);
  report.current = props.onActiveHeight;
  React.useEffect(() => {
    report.current?.(height);
  }, [height]);
  React.useEffect(() => () => report.current?.(undefined), []);

  // The live clamped height, mirrored off the shared value when the rounded
  // value changes (dev tool — re-renders during a resize are fine).
  const visible = React.useContext(BarWindowHeightContext);
  const [liveVisible, setLiveVisible] = React.useState<number | undefined>(undefined);
  useAnimatedReaction(
    () => (visible === undefined ? undefined : Math.round(visible.value)),
    (now, prev) => {
      if (now !== prev) runOnJS(setLiveVisible)(now);
    },
    [visible],
  );

  const state = props.state;
  const def = Math.round(state.defaultHeight);
  const act = state.activeHeight === undefined ? undefined : Math.round(state.activeHeight);
  const requested = Math.round(requestedHeightOf(state));
  const v = liveVisible ?? requested;
  const compactNow = isCompact(v);
  const viewport = contentViewport(v, DUBZ_TOP_BAR, DUBZ_BOTTOM_BAR);

  const requestedEq = state.pinned
    ? `requested = default ${def} = ${requested}   [pinned by drag]`
    : act === undefined
      ? `requested = default ${def} = ${requested}   (nothing active)`
      : `requested = max(active ${act}, default ${def}) = ${requested}`;
  const compactEq = `compact = (visible ${v} ≤ ${COMPACT_ZONE_MAX}) = ${compactNow}`;
  const viewportEq = compactNow
    ? `viewport = visible ${v} − bottom ${DUBZ_BOTTOM_BAR} = ${viewport}`
    : `viewport = visible ${v} − top ${DUBZ_TOP_BAR} − bottom ${DUBZ_BOTTOM_BAR} = ${viewport}`;

  return (
    // Whole area tappable (cycle). The "active component" is a block of EXACTLY
    // its claimed height — it changes on cycle, NOT when you drag the window.
    <Pressable onPress={() => setIndex((n) => (n + 1) % PROBE_HEIGHTS.length)} style={styles.root}>
      <View style={[styles.component, { height }]} />
      <View style={styles.readout} pointerEvents="none">
        <Text style={styles.caption}>active component = {height}px · tap to cycle ({index + 1}/{PROBE_HEIGHTS.length})</Text>
        <Text style={styles.eq}>{requestedEq}</Text>
        <Text style={styles.eq}>{compactEq}</Text>
        <Text style={[styles.eq, compactNow ? styles.eqHot : null]}>{viewportEq}</Text>
        {compactNow ? <Text style={styles.note}>↑ compact: the top bar is a side bar — NOT subtracted</Text> : null}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  // Content box: the component block sits at the bottom (like a real suggestion).
  root: { flex: 1, justifyContent: "flex-end" },
  // The active component — exactly its claimed height; width fills.
  component: { alignSelf: "stretch", backgroundColor: "rgba(74,222,128,0.14)", borderColor: "rgba(74,222,128,0.6)", borderWidth: 1, borderRadius: 14 },
  // Always-visible math overlay; taps pass through to the Pressable.
  readout: { position: "absolute", top: 8, left: 8, right: 8, backgroundColor: "rgba(0,0,0,0.68)", borderRadius: 10, padding: 10, gap: 5 },
  caption: { color: "#fff", fontSize: 13, fontWeight: "600", textAlign: "center", marginBottom: 2 },
  eq: { color: "#fff", fontSize: 12.5, fontFamily: "Menlo" },
  eqHot: { color: "#4ade80" },
  note: { color: "#4ade80", fontSize: 11.5, fontStyle: "italic" },
});
