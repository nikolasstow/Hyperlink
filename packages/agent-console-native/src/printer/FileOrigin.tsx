/**
 * How a print file was made, from the relay's Resin catalog: the runs
 * behind it (A and B, and what each tests), their checks, the key settings,
 * and their renders, with links to the runs. The print page shows it under
 * the File card.
 *
 * The catalog knows a file by its SHA-256. A printer file has only its
 * name here, so the relay matches the name against every name of each
 * library file's bytes, and says when two different files share it.
 *
 * @internal
 */
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import * as React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { markTap } from "../perfMonitor";
import type { RootStackParamList } from "../RootNavigator";
import { useTextColors } from "../theme";
import { originRoute, useCatalog, type RunDetail } from "./resinApi";
import { abDiff, deltaOf, flagLabel, fmtMetric, metricLabel } from "./resinFormat";
import { OutcomeChip, RenderTile, RunRow } from "./RunParts";
import { Card, CatalogProblem, Note, Row, usePalette } from "./ui";

/** The key metrics a plate compares, in this order. */
const COMPARE: ReadonlyArray<string> = ["placed", "failed", "burn_unsupported_islands", "burn_still_floating", "body_p99", "trees_gt1"];

const RENDER_SIZE = 112;

export const FileOrigin = (props: { readonly relayBase: string; readonly filename: string; readonly serverName: string; readonly serverAddress: string }): React.ReactElement => {
  const text = useTextColors();
  const palette = usePalette();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const origin = useCatalog(props.relayBase, originRoute(props.filename));
  const openRun = (runId: string): void => {
    markTap(`run ${runId}`);
    navigation.navigate("ServerResinRun", { serverName: props.serverName, serverAddress: props.serverAddress, runId });
  };

  if (origin.value === undefined) {
    return (
      <Card title="How this file was made">
        {origin.error !== undefined ? <CatalogProblem error={origin.error} unreachable={origin.unreachable} /> : <Note text="Asking the catalog…" />}
      </Card>
    );
  }
  const { print, runs, candidates } = origin.value;
  if (print === null) {
    return (
      <Card title="How this file was made">
        <Note text={candidates > 1 ? `${candidates} different files have this name, so the catalog cannot tell which one this is.` : "The run database has no print of this file."} />
      </Card>
    );
  }
  const runA = runs.find((run) => run.id === print.runA);
  const runB = runs.find((run) => run.id === print.runB);
  const plate: ReadonlyArray<{ readonly head: "A" | "B"; readonly run: RunDetail }> = [
    ...(runA !== undefined ? [{ head: "A" as const, run: runA }] : []),
    ...(runB !== undefined && runB.id !== runA?.id ? [{ head: "B" as const, run: runB }] : []),
  ];
  const missing = [print.runA, print.runB].filter((id): id is string => id !== null && !runs.some((run) => run.id === id));
  const tested = runA !== undefined && runB !== undefined && runA.id !== runB.id ? abDiff(runA.settings, runB.settings) : [];

  return (
    <>
      <Card title="How this file was made" right={<OutcomeChip outcome={print.outcome} />} flush>
        <View style={styles.recordLine}>
          <Text style={[styles.record, { color: text.secondaryLabel }]}>
            Print {print.id}
            {print.started !== null ? ` · ${print.started}` : ""}
            {print.exposure !== null ? ` · ${print.exposure} s` : ""}
          </Text>
        </View>
        {plate.map((entry, index) => (
          <RunRow key={entry.head} relayBase={props.relayBase} run={entry.run} head={plate.length > 1 ? entry.head : undefined} last={index === plate.length - 1 && missing.length === 0} onPress={() => openRun(entry.run.id)} />
        ))}
        {missing.length > 0 ? (
          <View style={styles.pad}>
            <Note text={`The run database has no run ${missing.join(" or ")}.`} tone="warn" />
          </View>
        ) : null}
        {print.notes !== null ? (
          <View style={styles.pad}>
            <Text style={[styles.notes, { color: text.label }]}>{print.notes}</Text>
          </View>
        ) : null}
      </Card>

      {tested.length > 0 ? (
        <Card title="What A and B test">
          {tested.map((change, index) => (
            <View key={change.flag} style={[styles.diffRow, index === tested.length - 1 ? null : styles.line]}>
              <Text style={[styles.diffFlag, { color: text.label }]} numberOfLines={1}>
                {flagLabel(change.flag)}
              </Text>
              <Text style={[styles.diffValue, { color: palette.accentInk }]} numberOfLines={1}>
                A {change.a ?? "off"}
              </Text>
              <Text style={[styles.diffValue, { color: text.secondaryLabel }]} numberOfLines={1}>
                B {change.b ?? "off"}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      {plate.length > 0 ? (
        <Card title="Checks">
          <View style={styles.compareHead}>
            <View style={styles.compareLabel} />
            {plate.map((entry) => (
              <Text key={entry.head} style={[styles.compareTitle, { color: text.tertiaryLabel }]}>
                {plate.length > 1 ? `${entry.head} · ${entry.run.id}` : entry.run.id}
              </Text>
            ))}
          </View>
          {plate[0]?.run.checks.map((check) => (
            <View key={check.key} style={[styles.compareRow, styles.line]}>
              <Text style={[styles.compareLabel, { color: text.secondaryLabel }]}>{check.label}</Text>
              {plate.map((entry) => {
                const passed = entry.run.checks.find((each) => each.key === check.key)?.passed ?? null;
                return (
                  <Text key={entry.head} style={[styles.compareValue, { color: passed === null ? text.tertiaryLabel : passed ? palette.ok : palette.bad }]}>
                    {passed === null ? "—" : passed ? "Passed" : "Failed"}
                  </Text>
                );
              })}
            </View>
          ))}
          {COMPARE.map((key, index) => (
            <View key={key} style={[styles.compareRow, index === COMPARE.length - 1 ? null : styles.line]}>
              <Text style={[styles.compareLabel, { color: text.secondaryLabel }]} numberOfLines={1}>
                {metricLabel(key)}
              </Text>
              {plate.map((entry) => {
                const metric = entry.run.metrics.find((each) => each.key === key);
                const delta = metric === undefined ? undefined : deltaOf(metric.value, metric.parent);
                return (
                  <Text key={entry.head} style={[styles.compareValue, { color: text.label }]}>
                    {metric === undefined ? "—" : fmtMetric(key, metric.value)}
                    {delta === "up" ? " ↑" : delta === "down" ? " ↓" : ""}
                  </Text>
                );
              })}
            </View>
          ))}
        </Card>
      ) : null}

      {plate.some((entry) => entry.run.changes.length > 0) ? (
        <Card title="Key settings">
          {plate.map((entry) => (
            <View key={entry.head} style={styles.changeBlock}>
              <Text style={[styles.changeTitle, { color: text.tertiaryLabel }]}>
                {plate.length > 1 ? `${entry.head} · ` : ""}
                {entry.run.id} against {entry.run.parent ?? "no parent"}
              </Text>
              {entry.run.changes.length === 0 ? (
                <Note text="The same flags as its parent." />
              ) : (
                entry.run.changes.map((change) => <Row key={change.flag} label={flagLabel(change.flag)} value={`${change.parent ?? "off"} → ${change.run ?? "off"}`} />)
              )}
            </View>
          ))}
        </Card>
      ) : null}

      {plate.some((entry) => entry.run.renders.length > 0) ? (
        <Card title="Renders" flush>
          {plate.map((entry) =>
            entry.run.renders.length === 0 ? null : (
              <View key={entry.head} style={styles.renderBlock}>
                <Text style={[styles.changeTitle, styles.renderTitle, { color: text.tertiaryLabel }]}>
                  {plate.length > 1 ? `${entry.head} · ` : ""}
                  {entry.run.id}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.renders}>
                  {entry.run.renders.map((name) => (
                    <RenderTile key={name} relayBase={props.relayBase} runId={entry.run.id} name={name} size={RENDER_SIZE} onPress={() => openRun(entry.run.id)} />
                  ))}
                </ScrollView>
              </View>
            ),
          )}
        </Card>
      ) : null}
    </>
  );
};

const styles = StyleSheet.create({
  recordLine: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 4 },
  record: { fontSize: 13, fontVariant: ["tabular-nums"] },
  pad: { paddingHorizontal: 16, paddingVertical: 12 },
  notes: { fontSize: 13.5, lineHeight: 19 },
  line: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(127,127,127,0.3)" },
  diffRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9 },
  diffFlag: { flex: 1, fontSize: 14 },
  diffValue: { width: 92, fontSize: 13, fontWeight: "600", textAlign: "right", fontVariant: ["tabular-nums"] },
  compareHead: { flexDirection: "row", alignItems: "center", paddingBottom: 6 },
  compareTitle: { width: 96, fontSize: 11, fontWeight: "700", textAlign: "right", letterSpacing: 0.3 },
  compareRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  compareLabel: { flex: 1, fontSize: 14 },
  compareValue: { width: 96, fontSize: 14, fontWeight: "600", textAlign: "right", fontVariant: ["tabular-nums"] },
  changeBlock: { marginBottom: 10 },
  changeTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 2 },
  renderBlock: { paddingTop: 8, paddingBottom: 12 },
  renderTitle: { paddingHorizontal: 16, marginBottom: 6 },
  renders: { paddingHorizontal: 16, gap: 10 },
});
