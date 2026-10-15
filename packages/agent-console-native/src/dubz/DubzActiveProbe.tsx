/**
 * DEV probe for the height model. Toggle `DUBZ_PROBE` in Dubz.tsx to swap the
 * home suggestions for this. It stands in as an "active component": tap to cycle
 * the reported active height through predetermined values, and read the live
 * calculation on screen — reporting-active → machine state → requested → the
 * clamped `visible` → compact — so the active-resize math can be SEEN and checked
 * rather than guessed.
 *
 * @internal
 */
import * as React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { runOnJS, useAnimatedReaction } from "react-native-reanimated";
import { BarWindowHeightContext } from "../BarWindow";
import { COMPACT_ZONE_MAX, isCompact } from "./dubzLayout";
import { SINGLE_SUGGESTION_HEIGHT } from "./DubzSessions";
import { requestedHeightOf, type DubzWindowState } from "./dubzWindowMachine";

/** Heights to cycle: the min, up through the compact-zone edge, and above it. */
const PROBE_HEIGHTS: ReadonlyArray<number> = [SINGLE_SUGGESTION_HEIGHT, 180, 240, 300, COMPACT_ZONE_MAX, 360, 440, 560];

const Row =(props: { readonly label: string; readonly value: string; readonly flag?: boolean }): React.ReactElement => (
  <View style={styles.row}>
    <Text style={styles.label}>{props.label}</Text>
    <Text style={[styles.value, props.flag === true ? styles.flagOn : null]}>{props.value}</Text>
  </View>
);

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
  const requested = Math.round(requestedHeightOf(state));
  const inZone = isCompact(requested);

  return (
    // Whole area tappable (cycle). The "active component" is a block of EXACTLY
    // its claimed height — it changes when you cycle, NOT when you drag the
    // window. A manual drag resizes the window around it (pins a default); the
    // component keeps its claim. The two are no longer locked.
    <Pressable onPress={() => setIndex((n) => (n + 1) % PROBE_HEIGHTS.length)} style={styles.root}>
      <View style={[styles.component, { height }]} />
      <View style={styles.readout} pointerEvents="none">
        <Text style={styles.caption}>active component = {height}px · tap to cycle ({index + 1}/{PROBE_HEIGHTS.length})</Text>
        <Row label="reporting active" value={`${height}`} />
        <Row label="state.activeHeight" value={state.activeHeight === undefined ? "—" : `${Math.round(state.activeHeight)}`} />
        <Row label="state.default" value={`${Math.round(state.defaultHeight)}`} />
        <Row label="state.pinned" value={state.pinned ? "yes" : "no"} flag={state.pinned} />
        <Row label="requested = f(state)" value={`${requested}`} />
        <Row label="visible (live, clamped)" value={liveVisible === undefined ? "—" : `${liveVisible}`} />
        <Row label="state.compact" value={state.compact ? "yes" : "no"} flag={state.compact} />
        <Row label={`isCompact(requested ≤ ${COMPACT_ZONE_MAX})`} value={inZone ? "yes" : "no"} flag={inZone} />
        <Row label="zone min..max" value={`${SINGLE_SUGGESTION_HEIGHT}..${COMPACT_ZONE_MAX}`} />
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
  readout: { position: "absolute", top: 8, left: 8, right: 8, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 10, padding: 10, gap: 4 },
  caption: { color: "#fff", fontSize: 13, fontWeight: "600", textAlign: "center", marginBottom: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { color: "rgba(255,255,255,0.7)", fontSize: 13 },
  value: { color: "#fff", fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"], minWidth: 64, textAlign: "right" },
  flagOn: { color: "#4ade80" },
});
