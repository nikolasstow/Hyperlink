/**
 * DEV probe for the height model. Toggle `DUBZ_PROBE` in Dubz.tsx to swap the
 * home suggestions for this. It stands in as an "active component" with a CONTENT
 * height you cycle (tap the block); it reports the ACTIVE CLAIM — the window
 * height needed to show that content = content + bars, and in the compact zone
 * the top bar is a side bar so it is NOT added. The equations show every step,
 * and +/− steppers tune the bar offsets.
 *
 * Steppers (onPress), NOT text inputs: a TextInput inside Dubz's gesture-wrapped,
 * glass-hosted body cannot take tap-focus, so typing never fired. onPress works
 * — that is how the block cycles.
 *
 * @internal
 */
import * as React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { runOnJS, useAnimatedReaction } from "react-native-reanimated";
import { BarWindowHeightContext } from "../BarWindow";
import { COMPACT_ZONE_MAX, isCompact } from "./dubzLayout";
import { DUBZ_BOTTOM_BAR, DUBZ_TOP_BAR } from "./DubzSessions";
import { requestedHeightOf, type DubzWindowState } from "./dubzWindowMachine";

/** CONTENT heights to cycle (what the component actually wants to show). With a
 * ~78 bottom bar, up to ~242 stays in the compact zone; above needs a top row. */
const PROBE_CONTENT: ReadonlyArray<number> = [44, 100, 160, 220, 280, 360, 440];
/** Points per +/− tap. */
const STEP = 2;

/** The active claim: the window height to show `content`. In the compact zone
 * (content + bottom fits it) the top controls are a side bar, so only the bottom
 * bar is added; otherwise the top bar takes a row too. */
const activeClaim = (content: number, topBar: number, bottomBar: number): { readonly active: number; readonly compact: boolean } => {
  const compact = content + bottomBar <= COMPACT_ZONE_MAX;
  return { active: compact ? content + bottomBar : content + topBar + bottomBar, compact };
};

const Stepper = (props: { readonly label: string; readonly value: number; readonly onChange: (next: number) => void }): React.ReactElement => (
  <View style={styles.field}>
    <Text style={styles.fieldLabel}>{props.label}</Text>
    <Pressable onPress={() => props.onChange(props.value - STEP)} style={styles.stepBtn} hitSlop={8}>
      <Text style={styles.stepTxt}>−</Text>
    </Pressable>
    <Text style={styles.stepVal}>{props.value}</Text>
    <Pressable onPress={() => props.onChange(props.value + STEP)} style={styles.stepBtn} hitSlop={8}>
      <Text style={styles.stepTxt}>+</Text>
    </Pressable>
  </View>
);

export const DubzActiveProbe = (props: {
  readonly state: DubzWindowState;
  readonly onActiveHeight?: (height: number | undefined) => void;
}): React.ReactElement => {
  const [index, setIndex] = React.useState(0);
  const content = PROBE_CONTENT[index] ?? PROBE_CONTENT[0] ?? 100;

  // Editable bar offsets (seeded from the real constants); +/− tune them live.
  const [topBar, setTopBar] = React.useState(DUBZ_TOP_BAR);
  const [bottomBar, setBottomBar] = React.useState(DUBZ_BOTTOM_BAR);

  const { active, compact: claimCompact } = activeClaim(content, topBar, bottomBar);

  // Report the active CLAIM (the window height needed), not the content.
  const report = React.useRef(props.onActiveHeight);
  report.current = props.onActiveHeight;
  React.useEffect(() => {
    report.current?.(active);
  }, [active]);
  React.useEffect(() => () => report.current?.(undefined), []);

  // The live clamped window height off the shared value.
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
  const requested = Math.round(requestedHeightOf(state));
  const win = liveVisible ?? requested;
  // Does the window actually show the content? window − the bars it reserves.
  const windowCompact = isCompact(win);
  const box = windowCompact ? win - bottomBar : win - topBar - bottomBar;
  const fits = box >= content;

  const claimEq = claimCompact
    ? `active = content ${content} + bottom ${bottomBar} = ${active}   (compact: no top bar)`
    : `active = content ${content} + top ${topBar} + bottom ${bottomBar} = ${active}`;
  const compactEq = `compact = (content ${content} + bottom ${bottomBar} = ${content + bottomBar}) ≤ ${COMPACT_ZONE_MAX} = ${claimCompact}`;
  const requestedEq = state.pinned
    ? `requested = default ${def} = ${requested}   [pinned by drag]`
    : `requested = max(active ${active}, default ${def}) = ${requested}`;
  const fitEq = `content box = window ${win} − ${windowCompact ? `bottom ${bottomBar}` : `top ${topBar} + bottom ${bottomBar}`} = ${box}`;

  return (
    <View style={styles.root}>
      <Pressable onPress={() => setIndex((n) => (n + 1) % PROBE_CONTENT.length)} style={[styles.component, { height: content }]} />
      <View style={styles.readout}>
        <Text style={styles.caption}>content = {content}px · tap the block to cycle ({index + 1}/{PROBE_CONTENT.length})</Text>
        <View style={styles.fields}>
          <Stepper label="top" value={topBar} onChange={setTopBar} />
          <Stepper label="bottom" value={bottomBar} onChange={setBottomBar} />
        </View>
        <Text style={styles.eq}>{compactEq}</Text>
        <Text style={[styles.eq, claimCompact ? styles.eqHot : null]}>{claimEq}</Text>
        <Text style={styles.eq}>{requestedEq}</Text>
        <Text style={styles.eq}>{fitEq}</Text>
        <Text style={[styles.eq, fits ? styles.ok : styles.bad]}>content {content} {fits ? "≤" : ">"} box {box} → {fits ? "FITS" : "WINDOW TOO SMALL"}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  component: { alignSelf: "stretch", backgroundColor: "rgba(74,222,128,0.14)", borderColor: "rgba(74,222,128,0.6)", borderWidth: 1, borderRadius: 14 },
  readout: { position: "absolute", top: 8, left: 8, right: 8, backgroundColor: "rgba(0,0,0,0.72)", borderRadius: 10, padding: 10, gap: 5 },
  caption: { color: "#fff", fontSize: 13, fontWeight: "600", textAlign: "center", marginBottom: 2 },
  eq: { color: "#fff", fontSize: 12.5, fontFamily: "Menlo" },
  eqHot: { color: "#4ade80" },
  ok: { color: "#4ade80" },
  bad: { color: "#f87171" },
  fields: { flexDirection: "row", gap: 16, marginTop: 2, marginBottom: 2 },
  field: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  fieldLabel: { color: "rgba(255,255,255,0.7)", fontSize: 13, minWidth: 48 },
  stepBtn: { width: 34, height: 34, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" },
  stepTxt: { color: "#fff", fontSize: 20, fontWeight: "700", lineHeight: 22 },
  stepVal: { color: "#fff", fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"], minWidth: 34, textAlign: "center" },
});
