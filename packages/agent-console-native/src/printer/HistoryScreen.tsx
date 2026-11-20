/**
 * The print history, from the relay's Resin catalog: a timeline of prints
 * by day, newest first, each with its outcome, what was printed (A and B
 * runs, with links), the exposure, and the owner's notes.
 *
 * A phone shows one card per print. A wide screen (iPad, landscape) puts
 * the notes in a column beside the print, so a long note does not push the
 * timeline down.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { markTap, useOpenTiming } from "../perfMonitor";
import type { RootStackParamList } from "../RootNavigator";
import { useTextColors, useScreenBackground } from "../theme";
import { historyRoute, useCatalog, type PrintRecord } from "./resinApi";
import { dayOf, describeFile, fmtDay, outcomeKindOf, timeOf } from "./resinFormat";
import { OutcomeChip, outcomeTone } from "./RunParts";
import { relayBaseOf } from "./sdcp";
import { Card, CatalogProblem, Note, toneColor, usePalette } from "./ui";

type Props = NativeStackScreenProps<RootStackParamList, "ServerResinHistory">;

/** The prints by day, in the order the relay gives (newest first). Prints with no date go last. */
export const daysOf = (prints: ReadonlyArray<PrintRecord>): ReadonlyArray<{ readonly day: string | undefined; readonly prints: ReadonlyArray<PrintRecord> }> => {
  const days: Array<{ day: string | undefined; prints: Array<PrintRecord> }> = [];
  prints.forEach((print) => {
    const day = dayOf(print.started);
    const last = days.at(-1);
    if (last !== undefined && last.day === day) last.prints.push(print);
    else days.push({ day, prints: [print] });
  });
  return days;
};

const RunLink = (props: { readonly head: "A" | "B" | undefined; readonly runId: string; readonly onPress: () => void }): React.ReactElement => {
  const palette = usePalette();
  return (
    <Pressable onPress={props.onPress} accessibilityRole="link" accessibilityLabel={`Run ${props.runId}`} style={({ pressed }) => [styles.runLink, { borderColor: palette.accent }, pressed && styles.pressed]}>
      <Text style={[styles.runLinkText, { color: palette.accentInk }]}>
        {props.head !== undefined ? `${props.head} · ` : ""}
        {props.runId}
      </Text>
    </Pressable>
  );
};

const PrintEntry = (props: { readonly print: PrintRecord; readonly wide: boolean; readonly openRun: (id: string) => void }): React.ReactElement => {
  const text = useTextColors();
  const palette = usePalette();
  const { print } = props;
  const identity = describeFile(print.file ?? print.id, print);
  const kind = outcomeKindOf(print.outcome);
  const dot = toneColor(palette, outcomeTone[kind], text.tertiaryLabel);
  const runs: ReadonlyArray<{ readonly head: "A" | "B" | undefined; readonly id: string }> =
    print.runA !== null && print.runB !== null && print.runA === print.runB
      ? [{ head: undefined, id: print.runA }]
      : [...(print.runA !== null ? [{ head: "A" as const, id: print.runA }] : []), ...(print.runB !== null ? [{ head: "B" as const, id: print.runB }] : [])];
  const main = (
    <View style={props.wide ? styles.wideMain : undefined}>
      <View style={styles.entryTop}>
        <Text style={[styles.entryId, { color: text.tertiaryLabel }]}>{print.id}</Text>
        <Text style={[styles.entryTime, { color: text.secondaryLabel }]} numberOfLines={1}>
          {timeOf(print.started) ?? ""}
        </Text>
        <OutcomeChip outcome={print.outcome} />
      </View>
      <Text style={[styles.entryTitle, { color: text.label }]} numberOfLines={1}>
        {identity.title}
      </Text>
      <Text style={[styles.entryOutcome, { color: text.secondaryLabel }]} numberOfLines={2}>
        {print.outcome ?? "No outcome recorded"}
        {print.exposure !== null ? ` · ${print.exposure} s` : ""}
      </Text>
      {runs.length > 0 ? (
        <View style={styles.runs}>
          {runs.map((run) => (
            <RunLink key={`${run.head ?? "both"}-${run.id}`} head={run.head} runId={run.id} onPress={() => props.openRun(run.id)} />
          ))}
        </View>
      ) : null}
      {print.file !== null ? (
        <Text style={[styles.entryFile, { color: text.tertiaryLabel }]} numberOfLines={1}>
          {print.file}
          {print.libraryPath !== null ? ` · ${print.libraryPath}` : ""}
        </Text>
      ) : null}
    </View>
  );
  return (
    <View style={styles.entry}>
      <View style={styles.rail}>
        <View style={[styles.railDot, { backgroundColor: dot }]} />
        <View style={styles.railLine} />
      </View>
      <Card style={styles.entryCard}>
        {props.wide ? (
          <View style={styles.wideRow}>
            {main}
            <Text style={[styles.notes, styles.wideNotes, { color: text.label }]}>{print.notes ?? "No notes."}</Text>
          </View>
        ) : (
          <>
            {main}
            {print.notes !== null ? <Text style={[styles.notes, { color: text.label }]}>{print.notes}</Text> : null}
          </>
        )}
      </Card>
    </View>
  );
};

type TimelineItem = { readonly kind: "Day"; readonly key: string; readonly day: string | undefined } | { readonly kind: "Print"; readonly key: string; readonly print: PrintRecord };

export const HistoryScreen = (props: Props): React.ReactElement => {
  useOpenTiming("ServerResinHistory");
  const background = useScreenBackground("grouped");
  const text = useTextColors();
  const { width } = useWindowDimensions();
  const { serverName, serverAddress } = props.route.params;
  const relayBase = relayBaseOf(serverAddress);
  const history = useCatalog(relayBase, historyRoute);
  const items = React.useMemo(
    (): ReadonlyArray<TimelineItem> =>
      daysOf(history.value?.prints ?? []).flatMap((group): ReadonlyArray<TimelineItem> => [
        { kind: "Day", key: `day-${group.day ?? "undated"}`, day: group.day },
        ...group.prints.map((print): TimelineItem => ({ kind: "Print", key: print.id, print })),
      ]),
    [history.value],
  );
  const wide = width >= 700;
  const contentWidth = Math.min(width - 32, 1100);
  const openRun = (runId: string): void => {
    markTap(`run ${runId}`);
    props.navigation.navigate("ServerResinRun", { serverName, serverAddress, runId });
  };

  return (
    <FlatList
        style={[styles.root, { backgroundColor: background }]}
        data={items}
        keyExtractor={(item) => item.key}
        initialNumToRender={6}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 40, width: contentWidth, alignSelf: "center" }}
        ListHeaderComponent={
          history.error !== undefined ? (
            <CatalogProblem error={history.error} unreachable={history.unreachable} />
          ) : history.value === undefined ? (
            <Note text="Reading the history…" />
          ) : history.value.prints.length === 0 ? (
            <Note text="The run database has no prints yet." />
          ) : null
        }
        renderItem={({ item }) =>
          item.kind === "Day" ? (
            <Text style={[styles.day, { color: text.secondaryLabel }]}>{item.day === undefined ? "NO DATE" : fmtDay(item.day).toUpperCase()}</Text>
          ) : (
            <PrintEntry print={item.print} wide={wide} openRun={openRun} />
          )
        }
      />
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  day: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, paddingLeft: 30, paddingTop: 12, paddingBottom: 8 },
  entry: { flexDirection: "row" },
  rail: { width: 30, alignItems: "center" },
  railDot: { width: 11, height: 11, borderRadius: 6, marginTop: 20 },
  railLine: { flex: 1, width: 2, marginTop: 4, backgroundColor: "rgba(127,127,127,0.25)", borderRadius: 1 },
  entryCard: { flex: 1 },
  entryTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  entryId: { fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] },
  entryTime: { flex: 1, fontSize: 12.5, fontVariant: ["tabular-nums"] },
  entryTitle: { fontSize: 17, fontWeight: "700", letterSpacing: -0.2, marginTop: 6 },
  entryOutcome: { fontSize: 13, marginTop: 2 },
  runs: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  runLink: { paddingHorizontal: 10, height: 26, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, justifyContent: "center" },
  runLinkText: { fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] },
  pressed: { opacity: 0.6 },
  entryFile: { fontSize: 11, marginTop: 8 },
  notes: { fontSize: 13.5, lineHeight: 19, marginTop: 10 },
  wideRow: { flexDirection: "row", gap: 20 },
  wideMain: { width: 300 },
  wideNotes: { flex: 1, marginTop: 0 },
});
