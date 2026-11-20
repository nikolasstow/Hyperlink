/**
 * Parts the Resin pages share: a run's row (render, id, what changed, check
 * badges), a render tile, and an outcome chip. Every size is fixed, so a
 * list never measures.
 *
 * @internal
 */
import * as React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { authedSource } from "../auth/serverTokens";
import { useTextColors } from "../theme";
import { renderUrl, type RunSummary } from "./resinApi";
import { fmtShortDate, OUTCOME_LABEL, outcomeKindOf, renderLabel, type OutcomeKind } from "./resinFormat";
import { CheckBadge, Chevron, Chip, LCD, type Tone } from "./ui";

/** A run row's height. */
export const RUN_ROW_HEIGHT = 78;
const THUMB = 58;

export const outcomeTone: Readonly<Record<OutcomeKind, Tone>> = {
  completed: "ok",
  separated: "warn",
  failed: "bad",
  stopped: "plain",
  unknown: "plain",
};

/** How a print ended, as a chip. */
export const OutcomeChip = (props: { readonly outcome: string | null }): React.ReactElement => {
  const kind = outcomeKindOf(props.outcome);
  return <Chip tone={outcomeTone[kind]} label={OUTCOME_LABEL[kind]} />;
};

/** One run: its render, its id, what it changed, and its checks. `head` marks A or B on a plate. */
export const RunRow = (props: {
  readonly relayBase: string;
  readonly run: RunSummary;
  readonly head?: "A" | "B";
  readonly last?: boolean;
  readonly onPress: () => void;
}): React.ReactElement => {
  const text = useTextColors();
  const { run } = props;
  return (
    <Pressable onPress={props.onPress} accessibilityRole="button" accessibilityLabel={`Run ${run.id}`} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.thumb}>
        {run.render !== null ? <Image source={authedSource(renderUrl(props.relayBase, run.id, run.render, true))} style={styles.thumbImage} resizeMode="cover" /> : <Text style={styles.noRender}>No render</Text>}
        {props.head !== undefined ? (
          <View style={styles.head}>
            <Text style={styles.headText}>{props.head}</Text>
          </View>
        ) : null}
      </View>
      <View style={[styles.main, props.last === true ? null : { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(127,127,127,0.3)" }]}>
        <View style={styles.top}>
          <Text style={[styles.id, { color: text.label }]}>{run.id}</Text>
          {run.created !== null ? <Text style={[styles.date, { color: text.tertiaryLabel }]}>{fmtShortDate(run.created)}</Text> : null}
        </View>
        <Text style={[styles.purpose, { color: text.secondaryLabel }]} numberOfLines={1}>
          {run.purpose ?? "No note of what changed"}
        </Text>
        <View style={styles.badges}>
          {run.checks.map((check) => (
            <CheckBadge key={check.key} label={check.label} passed={check.passed} />
          ))}
          {run.failed !== null ? <Text style={[styles.contacts, { color: text.tertiaryLabel }]}>{run.failed.toLocaleString()} failed</Text> : null}
          {run.prints.length > 0 ? <Text style={[styles.contacts, { color: text.tertiaryLabel }]}>· printed {run.prints.map((print) => print.id).join(", ")}</Text> : null}
        </View>
      </View>
      <Chevron color={text.tertiaryLabel} />
    </Pressable>
  );
};

/** One render at a fixed size, with its caption. */
export const RenderTile = (props: { readonly relayBase: string; readonly runId: string; readonly name: string; readonly size: number; readonly onPress: () => void }): React.ReactElement => {
  const text = useTextColors();
  return (
    <Pressable onPress={props.onPress} accessibilityRole="imagebutton" accessibilityLabel={renderLabel(props.name)} style={{ width: props.size }}>
      <Image source={authedSource(renderUrl(props.relayBase, props.runId, props.name, true))} style={[styles.tile, { width: props.size, height: props.size }]} resizeMode="cover" />
      <Text style={[styles.caption, { color: text.secondaryLabel }]} numberOfLines={1}>
        {renderLabel(props.name)}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", height: RUN_ROW_HEIGHT, paddingLeft: 16, paddingRight: 14, gap: 12 },
  pressed: { backgroundColor: "rgba(127,127,127,0.12)" },
  thumb: { width: THUMB, height: THUMB, borderRadius: 12, backgroundColor: LCD, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  thumbImage: { width: THUMB, height: THUMB },
  head: { position: "absolute", left: 4, top: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  noRender: { color: "rgba(244,245,249,0.5)", fontSize: 9 },
  headText: { color: "#ffffff", fontSize: 11, fontWeight: "700" },
  main: { flex: 1, height: RUN_ROW_HEIGHT, justifyContent: "center", gap: 3 },
  top: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  id: { fontSize: 16, fontWeight: "600", fontVariant: ["tabular-nums"] },
  date: { fontSize: 12, fontVariant: ["tabular-nums"] },
  purpose: { fontSize: 13 },
  badges: { flexDirection: "row", alignItems: "center", gap: 6 },
  contacts: { fontSize: 11.5, fontVariant: ["tabular-nums"] },
  tile: { borderRadius: 12, backgroundColor: LCD },
  caption: { fontSize: 11.5, marginTop: 4 },
});
