/**
 * DEV probe for the height model. Toggle `DUBZ_PROBE` in Dubz.tsx to swap the
 * home suggestions for this. It stands in as an "active component" (a block of
 * exactly its claimed height — tap the block to cycle), shows the model's math
 * as the literal EQUATIONS substituted with live numbers, and lets you edit the
 * top/bottom bar offsets to tune them — so you can see, e.g., the compact
 * viewport drop the top bar.
 *
 * @internal
 */
import * as React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { runOnJS, useAnimatedReaction } from "react-native-reanimated";
import { BarWindowHeightContext } from "../BarWindow";
import { COMPACT_ZONE_MAX, contentViewport, isCompact } from "./dubzLayout";
import { DUBZ_BOTTOM_BAR, DUBZ_TOP_BAR, SINGLE_SUGGESTION_HEIGHT } from "./DubzSessions";
import { requestedHeightOf, type DubzWindowState } from "./dubzWindowMachine";

/** Heights to cycle: the min, up through the compact-zone edge, and above it. */
const PROBE_HEIGHTS: ReadonlyArray<number> = [SINGLE_SUGGESTION_HEIGHT, 180, 240, 300, COMPACT_ZONE_MAX, 360, 440, 560];

/** A labelled numeric input for an offset. */
const Field = (props: { readonly label: string; readonly value: string; readonly onChange: (next: string) => void }): React.ReactElement => (
  <View style={styles.field}>
    <Text style={styles.fieldLabel}>{props.label}</Text>
    <TextInput style={styles.input} value={props.value} onChangeText={props.onChange} keyboardType="number-pad" selectTextOnFocus returnKeyType="done" />
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

  // Editable bar offsets (seeded from the real constants), so they can be tuned
  // live and the equation recomputes.
  const [topStr, setTopStr] = React.useState(String(DUBZ_TOP_BAR));
  const [bottomStr, setBottomStr] = React.useState(String(DUBZ_BOTTOM_BAR));
  const topBar = Number(topStr) || 0;
  const bottomBar = Number(bottomStr) || 0;

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
  const viewport = contentViewport(v, topBar, bottomBar);

  const requestedEq = state.pinned
    ? `requested = default ${def} = ${requested}   [pinned by drag]`
    : act === undefined
      ? `requested = default ${def} = ${requested}   (nothing active)`
      : `requested = max(active ${act}, default ${def}) = ${requested}`;
  const compactEq = `compact = (visible ${v} ≤ ${COMPACT_ZONE_MAX}) = ${compactNow}`;
  const viewportEq = compactNow
    ? `viewport = visible ${v} − bottom ${bottomBar} = ${viewport}   (top ${topBar} excluded)`
    : `viewport = visible ${v} − top ${topBar} − bottom ${bottomBar} = ${viewport}`;

  return (
    // The component block (tap to cycle) sits at the bottom, exactly its claimed
    // height. The readout overlay carries the equations and the editable offsets.
    <View style={styles.root}>
      <Pressable onPress={() => setIndex((n) => (n + 1) % PROBE_HEIGHTS.length)} style={[styles.component, { height }]} />
      <View style={styles.readout}>
        <Text style={styles.caption}>active component = {height}px · tap the block to cycle ({index + 1}/{PROBE_HEIGHTS.length})</Text>
        {/* Inputs first, so they stay reachable even when the window is short. */}
        <View style={styles.fields}>
          <Field label="top" value={topStr} onChange={setTopStr} />
          <Field label="bottom" value={bottomStr} onChange={setBottomStr} />
        </View>
        <Text style={styles.eq}>{requestedEq}</Text>
        <Text style={styles.eq}>{compactEq}</Text>
        <Text style={[styles.eq, compactNow ? styles.eqHot : null]}>{viewportEq}</Text>
        {compactNow ? <Text style={styles.note}>↑ compact: the top bar is a side bar — NOT subtracted</Text> : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // Content box: the component block sits at the bottom (like a real suggestion).
  root: { flex: 1, justifyContent: "flex-end" },
  // The active component — exactly its claimed height; width fills; tap to cycle.
  component: { alignSelf: "stretch", backgroundColor: "rgba(74,222,128,0.14)", borderColor: "rgba(74,222,128,0.6)", borderWidth: 1, borderRadius: 14 },
  // Equations + offset inputs, over the top of the block.
  readout: { position: "absolute", top: 8, left: 8, right: 8, backgroundColor: "rgba(0,0,0,0.72)", borderRadius: 10, padding: 10, gap: 5 },
  caption: { color: "#fff", fontSize: 13, fontWeight: "600", textAlign: "center", marginBottom: 2 },
  eq: { color: "#fff", fontSize: 12.5, fontFamily: "Menlo" },
  eqHot: { color: "#4ade80" },
  note: { color: "#4ade80", fontSize: 11.5, fontStyle: "italic" },
  fields: { flexDirection: "row", gap: 10, marginTop: 4 },
  field: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  fieldLabel: { color: "rgba(255,255,255,0.7)", fontSize: 12.5 },
  input: { flex: 1, color: "#fff", fontSize: 14, fontFamily: "Menlo", backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
});
