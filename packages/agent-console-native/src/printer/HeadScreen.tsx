/**
 * The Beast head's history, from the relay's Resin catalog: at the top, the
 * requirements for the next print with their status and evidence; then the
 * timeline of prints P1 to P8 with their outcomes and the owner's notes in
 * place, and the runs since the last print.
 *
 * The requirements and notes live in runs.db (`rundb.py req` and `rundb.py
 * note`). A wide screen puts the requirements beside the timeline.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { markTap, useOpenTiming } from "../perfMonitor";
import type { RootStackParamList } from "../RootNavigator";
import { useScreenBackground, useTextColors, withAlpha } from "../theme";
import { historyRoute, notesRoute, requirementsRoute, runsRoute, useCatalog, type HeadNote, type PrintRecord, type Requirement } from "./resinApi";
import { describeFile, headTimeline, startedMs } from "./resinFormat";
import { OutcomeChip, RUN_ROW_HEIGHT, RunRow } from "./RunParts";
import { relayBaseOf } from "./sdcp";
import { Card, CatalogProblem, Note, usePalette, type Palette } from "./ui";

type Props = NativeStackScreenProps<RootStackParamList, "ServerResinHead">;

/** How many runs since the last print the page lists. */
const LATEST_RUNS = 5;

const STATUS_LABEL: Readonly<Record<Requirement["status"], string>> = { open: "Open", met: "Met", failed: "Failed", waived: "Waived" };

const statusColor = (palette: Palette, status: Requirement["status"], plain: string): string =>
  status === "met" ? palette.ok : status === "failed" ? palette.bad : status === "waived" ? plain : palette.warn;

/** One requirement: its status, its words, and the run and check that show it. */
export const RequirementRow = (props: { readonly requirement: Requirement; readonly last: boolean; readonly onRun: (id: string) => void; readonly forRun?: string }): React.ReactElement => {
  const text = useTextColors();
  const palette = usePalette();
  const { requirement } = props;
  const runCheck = props.forRun === undefined ? undefined : requirement.checks.find((check) => check.run === props.forRun);
  const status = runCheck !== undefined ? runCheck.result : requirement.status;
  const color = statusColor(palette, status, "#8E8E93");
  const evidence = runCheck !== undefined ? [runCheck.check_name, runCheck.value].filter((part) => part !== null).join(" = ") : requirement.evidence;
  const run = runCheck?.run ?? requirement.verifiedRun;
  return (
    <View style={[styles.requirement, props.last ? null : styles.line]}>
      <View style={[styles.status, { backgroundColor: withAlpha(color, 0.16) }]}>
        <Text style={[styles.statusText, { color }]}>{STATUS_LABEL[status]}</Text>
      </View>
      <View style={styles.requirementMain}>
        <Text style={[styles.requirementText, { color: text.label }]}>
          <Text style={{ color: text.tertiaryLabel }}>{requirement.id} </Text>
          {requirement.text}
        </Text>
        <Text style={[styles.requirementMeta, { color: text.tertiaryLabel }]}>
          {requirement.scope === "print" ? "This print" : "Standing"}
          {requirement.required ? "" : " · not required"}
          {requirement.quote !== null ? ` · “${requirement.quote}”` : ""}
        </Text>
        {run !== null || (evidence !== null && evidence !== "") ? (
          <Pressable disabled={run === null} onPress={() => (run === null ? undefined : props.onRun(run))} hitSlop={6}>
            <Text style={[styles.evidence, { color: run === null ? text.secondaryLabel : palette.accentInk }]}>
              {run !== null ? `Run ${run}` : ""}
              {run !== null && evidence !== null && evidence !== "" ? " · " : ""}
              {evidence ?? ""}
            </Text>
          </Pressable>
        ) : (
          <Text style={[styles.evidence, { color: text.tertiaryLabel }]}>No run shows it yet.</Text>
        )}
      </View>
    </View>
  );
};

const NoteLine = (props: { readonly note: HeadNote; readonly onRun: (id: string) => void }): React.ReactElement => {
  const text = useTextColors();
  const palette = usePalette();
  const { note } = props;
  return (
    <View style={[styles.note, { borderLeftColor: note.author === "owner" ? palette.accent : "rgba(127,127,127,0.4)" }]}>
      <Text style={[styles.noteMeta, { color: text.tertiaryLabel }]}>
        {note.author === "owner" ? "Owner" : "Agent"} · {note.at}
        {note.run !== null ? " · " : ""}
        {note.run !== null ? (
          <Text style={{ color: palette.accentInk }} onPress={() => props.onRun(note.run ?? "")}>
            run {note.run}
          </Text>
        ) : null}
      </Text>
      <Text style={[styles.noteText, { color: text.label }]}>{note.text}</Text>
    </View>
  );
};

const PrintEvent = (props: { readonly print: PrintRecord; readonly notes: ReadonlyArray<HeadNote>; readonly onRun: (id: string) => void }): React.ReactElement => {
  const text = useTextColors();
  const palette = usePalette();
  const { print } = props;
  const identity = describeFile(print.file ?? print.id, print);
  const runs = [print.runA, print.runB].filter((id, index, all): id is string => id !== null && all.indexOf(id) === index);
  return (
    <Card>
      <View style={styles.printTop}>
        <Text style={[styles.printId, { color: text.tertiaryLabel }]}>{print.id}</Text>
        <Text style={[styles.printTime, { color: text.secondaryLabel }]} numberOfLines={1}>
          {print.started ?? ""}
        </Text>
        <OutcomeChip outcome={print.outcome} />
      </View>
      <Text style={[styles.printTitle, { color: text.label }]} numberOfLines={1}>
        {identity.title}
      </Text>
      <Text style={[styles.printOutcome, { color: text.secondaryLabel }]}>
        {print.outcome ?? "No outcome recorded"}
        {print.exposure !== null ? ` · ${print.exposure} s` : ""}
      </Text>
      {runs.length > 0 ? (
        <View style={styles.runLinks}>
          {runs.map((id) => (
            <Pressable key={id} onPress={() => props.onRun(id)} style={[styles.runLink, { borderColor: palette.accent }]} accessibilityRole="link">
              <Text style={[styles.runLinkText, { color: palette.accentInk }]}>
                {id === print.runA && print.runA !== print.runB ? "A · " : id === print.runB && print.runA !== print.runB ? "B · " : ""}
                {id}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {props.notes.map((note) => (
        <NoteLine key={note.id} note={note} onRun={props.onRun} />
      ))}
    </Card>
  );
};

export const HeadScreen = (props: Props): React.ReactElement => {
  useOpenTiming("ServerResinHead");
  const background = useScreenBackground("grouped");
  const text = useTextColors();
  const { width } = useWindowDimensions();
  const { serverName, serverAddress } = props.route.params;
  const relayBase = relayBaseOf(serverAddress);
  const requirements = useCatalog(relayBase, requirementsRoute);
  const notes = useCatalog(relayBase, notesRoute);
  const history = useCatalog(relayBase, historyRoute);
  const runs = useCatalog(relayBase, runsRoute);
  const openRun = (id: string): void => {
    markTap(`run ${id}`);
    props.navigation.navigate("ServerResinRun", { serverName, serverAddress, runId: id });
  };
  const wide = width >= 700;
  const contentWidth = Math.min(width - 32, 1100);
  const columnWidth = wide ? Math.floor((contentWidth - 14) / 2) : contentWidth;

  const events = React.useMemo(() => headTimeline(history.value?.prints ?? [], notes.value?.notes ?? []), [history.value, notes.value]);
  // The runs since the last print started: what the next print is being made from.
  const lastPrint = React.useMemo(() => {
    const started = (history.value?.prints ?? []).map((print) => ({ print, at: startedMs(print.started) ?? 0 }));
    return started.reduce<{ readonly print: PrintRecord; readonly at: number } | undefined>((best, each) => (best === undefined || each.at > best.at ? each : best), undefined);
  }, [history.value]);
  const since = React.useMemo(() => (lastPrint === undefined ? [] : (runs.value?.runs ?? []).filter((run) => run.created !== null && run.created > lastPrint.at)), [runs.value, lastPrint]);

  const list = requirements.value?.requirements ?? [];
  const required = list.filter((requirement) => requirement.required);
  const met = required.filter((requirement) => requirement.status === "met").length;

  const checklist = (
    <Card title="Next print" right={<Text style={[styles.count, { color: text.tertiaryLabel }]}>{requirements.value === undefined ? "" : `${met} of ${required.length} met`}</Text>} flush>
      {requirements.error !== undefined ? (
        <View style={styles.pad}>
          <CatalogProblem error={requirements.error} unreachable={requirements.unreachable} />
        </View>
      ) : requirements.value === undefined ? (
        <View style={styles.pad}>
          <Note text="Reading the requirements…" />
        </View>
      ) : list.length === 0 ? (
        <View style={styles.pad}>
          <Note text="No requirements yet. Add them with rundb.py req add." />
        </View>
      ) : (
        list.map((requirement, index) => <RequirementRow key={requirement.id} requirement={requirement} last={index === list.length - 1} onRun={openRun} />)
      )}
    </Card>
  );

  const timeline = (
    <>
      {history.error !== undefined || notes.error !== undefined ? (
        <Card title="History">
          <CatalogProblem error={history.error ?? notes.error ?? ""} unreachable={history.unreachable || notes.unreachable} />
        </Card>
      ) : history.value === undefined || notes.value === undefined ? (
        <Card title="History">
          <Note text="Reading the prints and notes…" />
        </Card>
      ) : null}
      {events.map((event, index) =>
        event.kind === "Print" ? (
          <View key={event.key}>
            {index === 0 ? <View style={styles.historyHead} /> : null}
            <PrintEvent print={event.print} notes={event.notes} onRun={openRun} />
          </View>
        ) : (
          <View key={event.key} style={styles.looseNote}>
            <NoteLine note={event.note} onRun={openRun} />
          </View>
        ),
      )}
      {lastPrint !== undefined ? (
        <Card title={`Runs since ${lastPrint.print.id}`} right={<Text style={[styles.count, { color: text.tertiaryLabel }]}>{runs.value === undefined ? "…" : `${since.length} runs`}</Text>} flush>
          {runs.error !== undefined ? (
            <View style={styles.pad}>
              <CatalogProblem error={runs.error} unreachable={runs.unreachable} />
            </View>
          ) : runs.value === undefined ? (
            <View style={styles.pad}>
              <Note text="Reading the runs…" />
            </View>
          ) : since.length === 0 ? (
            <View style={styles.pad}>
              <Note text="No run since the last print." />
            </View>
          ) : (
            <View style={{ height: Math.min(LATEST_RUNS, since.length) * RUN_ROW_HEIGHT }}>
              {since.slice(0, LATEST_RUNS).map((run, index, shown) => (
                <RunRow key={run.id} relayBase={relayBase} run={run} last={index === shown.length - 1} onPress={() => openRun(run.id)} />
              ))}
            </View>
          )}
        </Card>
      ) : null}
    </>
  );

  return (
    <ScrollView style={[styles.root, { backgroundColor: background }]} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
      <View style={{ width: contentWidth, alignSelf: "center" }}>
        {wide ? (
          <View style={styles.columns}>
            <View style={{ width: columnWidth }}>{checklist}</View>
            <View style={{ width: columnWidth }}>{timeline}</View>
          </View>
        ) : (
          <>
            {checklist}
            {timeline}
          </>
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  columns: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  count: { fontSize: 12 },
  pad: { paddingHorizontal: 16, paddingVertical: 12 },
  line: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(127,127,127,0.3)" },
  requirement: { flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  status: { width: 58, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", marginTop: 1 },
  statusText: { fontSize: 12, fontWeight: "700" },
  requirementMain: { flex: 1, gap: 3 },
  requirementText: { fontSize: 14.5, lineHeight: 20 },
  requirementMeta: { fontSize: 12 },
  evidence: { fontSize: 12.5, fontWeight: "600", fontVariant: ["tabular-nums"] },
  historyHead: { height: 6 },
  printTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  printId: { fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] },
  printTime: { flex: 1, fontSize: 12.5, fontVariant: ["tabular-nums"] },
  printTitle: { fontSize: 17, fontWeight: "700", letterSpacing: -0.2, marginTop: 6 },
  printOutcome: { fontSize: 13, marginTop: 2 },
  runLinks: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  runLink: { paddingHorizontal: 10, height: 26, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, justifyContent: "center" },
  runLinkText: { fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] },
  note: { borderLeftWidth: 3, paddingLeft: 10, marginTop: 10, gap: 2 },
  noteMeta: { fontSize: 11.5 },
  noteText: { fontSize: 13.5, lineHeight: 19 },
  looseNote: { paddingHorizontal: 4, marginBottom: 14 },
});
