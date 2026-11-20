/**
 * One task of a project (one part being printed, such as the Beast's head),
 * from the relay's Resin catalog: at the top, the requirements for the next
 * print with their status and evidence; then the timeline of the task's
 * prints with their outcomes and the notes in place, the runs since the last
 * print, and the task's library files.
 *
 * Projects, tasks, requirements, and notes live in runs.db (`rundb.py
 * project`, `task`, `req`, and `note`). A wide screen puts the requirements
 * beside the timeline.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { markTap, useOpenTiming } from "../perfMonitor";
import type { RootStackParamList } from "../RootNavigator";
import { useScreenBackground, useTextColors, withAlpha } from "../theme";
import { historyRoute, libraryRoute, notesRoute, projectsRoute, requirementsRoute, runsRoute, useCatalog, type CheckResult, type HeadNote, type LibraryFile, type PrintRecord, type Requirement } from "./resinApi";
import { describeFile, fmtShortDate, headTimeline, inTask, startedMs } from "./resinFormat";
import { OutcomeChip, RUN_ROW_HEIGHT, RunRow } from "./RunParts";
import { relayBaseOf } from "./sdcp";
import { Card, CatalogProblem, Note, usePalette, type Palette } from "./ui";

type Props = NativeStackScreenProps<RootStackParamList, "ServerResinTask">;

/** How many runs since the last print the page lists. */
const LATEST_RUNS = 5;

const STATUS_LABEL: Readonly<Record<Requirement["status"], string>> = { open: "Open", met: "Met", failed: "Failed", waived: "Waived" };

const statusColor = (palette: Palette, status: Requirement["status"], plain: string): string =>
  status === "met" ? palette.ok : status === "failed" ? palette.bad : status === "waived" ? plain : palette.warn;

/** A requirement's status: waived by hand, else from its newest checks (failed if any head failed), else as set by hand. */
export const requirementStatus = (requirement: Requirement, checks: ReadonlyArray<CheckResult>): Requirement["status"] =>
  requirement.status === "waived" ? "waived" : checks.length === 0 ? requirement.status : checks.some((check) => check.result === "failed") ? "failed" : "met";

/** One check in a line: the head, the run, and what it measured. */
const CheckLine = (props: { readonly check: CheckResult; readonly onRun: (id: string) => void }): React.ReactElement => {
  const text = useTextColors();
  const palette = usePalette();
  const { check } = props;
  const runId = check.runId;
  return (
    <Pressable disabled={runId === null} onPress={() => (runId === null ? undefined : props.onRun(runId))} hitSlop={4}>
      <Text style={[styles.evidence, { color: text.secondaryLabel }]} numberOfLines={3}>
        <Text style={{ color: check.result === "met" ? palette.ok : palette.bad }}>{check.result === "met" ? "✓" : "✕"} </Text>
        <Text style={{ color: runId === null ? text.secondaryLabel : palette.accentInk }}>
          {check.head !== null ? `${check.head} · ` : ""}
          {runId ?? check.folder ?? check.ref}
        </Text>
        {check.evidence !== null && check.evidence !== "" ? ` · ${check.evidence}` : ""}
      </Text>
    </Pressable>
  );
};

/**
 * One requirement: its status, its words, and the newest check per head
 * with its evidence. With `forRun`, only that run's checks count.
 */
export const RequirementRow = (props: {
  readonly requirement: Requirement;
  readonly last: boolean;
  readonly onRun: (id: string) => void;
  readonly forRun?: { readonly id: string; readonly folder: string };
}): React.ReactElement => {
  const text = useTextColors();
  const palette = usePalette();
  const { requirement, forRun } = props;
  const shown = forRun === undefined ? requirement.latest : requirement.checks.filter((check) => check.runId === forRun.id || check.folder === forRun.folder);
  const status = requirementStatus(requirement, shown);
  const color = statusColor(palette, status, "#8E8E93");
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
          {forRun === undefined && requirement.history.length > 0 ? ` · ${requirement.history.length} checks` : ""}
        </Text>
        {shown.length > 0 ? (
          shown.map((check) => <CheckLine key={`${check.ref}-${check.at}`} check={check} onRun={props.onRun} />)
        ) : requirement.evidence !== null ? (
          <Text style={[styles.evidence, { color: text.secondaryLabel }]}>
            {requirement.verifiedRun !== null ? `${requirement.verifiedRun} · ` : ""}
            {requirement.evidence}
          </Text>
        ) : (
          <Text style={[styles.evidence, { color: text.tertiaryLabel }]}>No check yet.</Text>
        )}
      </View>
    </View>
  );
};

/** Every check of the task's requirements, newest first, up to `MAX_CHECKS`. */
const CheckHistory = (props: { readonly requirements: ReadonlyArray<Requirement>; readonly onRun: (id: string) => void }): React.ReactElement | null => {
  const text = useTextColors();
  const all = props.requirements.flatMap((requirement) => requirement.history).sort((a, b) => b.at.localeCompare(a.at));
  if (all.length === 0) return null;
  return (
    <Card title="Check history" right={<Text style={[styles.count, { color: text.tertiaryLabel }]}>{all.length} checks</Text>}>
      {all.slice(0, MAX_CHECKS).map((check, index) => (
        <View key={`${check.requirement}-${check.ref}-${check.at}-${index}`} style={styles.historyRow}>
          <Text style={[styles.historyMeta, { color: text.tertiaryLabel }]}>
            {check.at.replace("T", " ").slice(0, 16)} · {check.requirement}
          </Text>
          <CheckLine check={check} onRun={props.onRun} />
        </View>
      ))}
      {all.length > MAX_CHECKS ? <Note text={`${all.length - MAX_CHECKS} older checks are in runs.db.`} /> : null}
    </Card>
  );
};

/** How many checks the history card lists. */
const MAX_CHECKS = 200;

/** How many files the task page lists; Library has the rest. */
const MAX_FILES = 12;

/** A library file of the task: what it is, its print, and its date. The file name goes small. */
const FileLine = (props: { readonly file: LibraryFile; readonly last: boolean }): React.ReactElement => {
  const text = useTextColors();
  const identity = describeFile(props.file.name, props.file.print);
  return (
    <View style={[styles.file, props.last ? null : styles.line]}>
      <View style={styles.fileTop}>
        <Text style={[styles.fileTitle, { color: text.label }]} numberOfLines={1}>
          {identity.title}
        </Text>
        {props.file.print !== null ? <OutcomeChip outcome={props.file.print.outcome} /> : <Text style={[styles.fileDate, { color: text.tertiaryLabel }]}>{fmtShortDate(props.file.modified)}</Text>}
      </View>
      {identity.detail !== undefined ? <Text style={[styles.fileDetail, { color: text.secondaryLabel }]}>{identity.detail}</Text> : null}
      <Text style={[styles.fileName, { color: text.tertiaryLabel }]} numberOfLines={1}>
        {props.file.path}
      </Text>
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

export const TaskScreen = (props: Props): React.ReactElement => {
  useOpenTiming("ServerResinTask");
  const background = useScreenBackground("grouped");
  const text = useTextColors();
  const { width } = useWindowDimensions();
  const { serverName, serverAddress, taskId } = props.route.params;
  const relayBase = relayBaseOf(serverAddress);
  const projects = useCatalog(relayBase, projectsRoute);
  const allRequirements = useCatalog(relayBase, requirementsRoute);
  const allNotes = useCatalog(relayBase, notesRoute);
  const history = useCatalog(relayBase, historyRoute);
  const allRuns = useCatalog(relayBase, runsRoute);
  const library = useCatalog(relayBase, libraryRoute);
  const task = React.useMemo(() => projects.value?.projects.flatMap((project) => project.tasks).find((each) => each.id === taskId), [projects.value, taskId]);
  // Only this task's prints, runs, notes, requirements, and files.
  const prints = React.useMemo(() => (history.value?.prints ?? []).filter((print) => task?.prints.includes(print.id) === true), [history.value, task]);
  const runIds = React.useMemo(() => new Set(task?.runs ?? []), [task]);
  const runsOfTask = React.useMemo(() => (allRuns.value?.runs ?? []).filter((run) => runIds.has(run.id)), [allRuns.value, runIds]);
  const notesOfTask = React.useMemo(() => (allNotes.value?.notes ?? []).filter((note) => note.task === taskId), [allNotes.value, taskId]);
  const files = React.useMemo(() => (task === undefined ? [] : (library.value?.files ?? []).filter((file) => inTask(task, file.path))), [library.value, task]);
  const requirements = { ...allRequirements, value: allRequirements.value === undefined ? undefined : { requirements: allRequirements.value.requirements.filter((requirement) => requirement.task === taskId) } };
  const notes = { ...allNotes, value: allNotes.value === undefined ? undefined : { notes: notesOfTask } };
  const runs = { ...allRuns, value: allRuns.value === undefined ? undefined : { runs: runsOfTask } };
  const openRun = (id: string): void => {
    markTap(`run ${id}`);
    props.navigation.navigate("ServerResinRun", { serverName, serverAddress, runId: id });
  };
  const wide = width >= 700;
  const contentWidth = Math.min(width - 32, 1100);
  const columnWidth = wide ? Math.floor((contentWidth - 14) / 2) : contentWidth;

  const events = React.useMemo(() => headTimeline(prints, notesOfTask), [prints, notesOfTask]);
  // The runs since the last print started: what the next print is being made from.
  const lastPrint = React.useMemo(() => {
    const started = prints.map((print) => ({ print, at: startedMs(print.started) ?? 0 }));
    return started.reduce<{ readonly print: PrintRecord; readonly at: number } | undefined>((best, each) => (best === undefined || each.at > best.at ? each : best), undefined);
  }, [prints]);
  const since = React.useMemo(() => (lastPrint === undefined ? runsOfTask : runsOfTask.filter((run) => run.created !== null && run.created > lastPrint.at)), [runsOfTask, lastPrint]);

  const list = requirements.value?.requirements ?? [];
  const required = list.filter((requirement) => requirement.required);
  const met = required.filter((requirement) => requirementStatus(requirement, requirement.latest) === "met").length;

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
  const checkHistory = <CheckHistory requirements={list} onRun={openRun} />;

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
      {projects.error !== undefined ? (
        <Card title="Task">
          <CatalogProblem error={projects.error} unreachable={projects.unreachable} />
        </Card>
      ) : projects.value !== undefined && task === undefined ? (
        <Card title="Task">
          <Note text={`The catalog has no task ${taskId}.`} tone="bad" />
        </Card>
      ) : null}
      {runsOfTask.length > 0 ? (
        <Card title={lastPrint === undefined ? "Runs" : `Runs since ${lastPrint.print.id}`} right={<Text style={[styles.count, { color: text.tertiaryLabel }]}>{runs.value === undefined ? "…" : `${since.length} runs`}</Text>} flush>
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
      {task !== undefined && task.patterns.length > 0 ? (
        <Card title="Files" right={<Text style={[styles.count, { color: text.tertiaryLabel }]}>{library.value === undefined ? "…" : `${files.length}`}</Text>} flush>
          {library.error !== undefined ? (
            <View style={styles.pad}>
              <CatalogProblem error={library.error} unreachable={library.unreachable} />
            </View>
          ) : library.value === undefined ? (
            <View style={styles.pad}>
              <Note text="Reading the library…" />
            </View>
          ) : files.length === 0 ? (
            <View style={styles.pad}>
              <Note text="No library file matches this task." />
            </View>
          ) : (
            files.slice(0, MAX_FILES).map((file, index, shown) => <FileLine key={file.path} file={file} last={index === shown.length - 1} />)
          )}
          {files.length > MAX_FILES ? (
            <View style={styles.pad}>
              <Note text={`${files.length - MAX_FILES} more in Library.`} />
            </View>
          ) : null}
        </Card>
      ) : null}
    </>
  );

  return (
    <ScrollView style={[styles.root, { backgroundColor: background }]} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
      <View style={{ width: contentWidth, alignSelf: "center" }}>
        {wide ? (
          <View style={styles.columns}>
            <View style={{ width: columnWidth }}>
              {checklist}
              {checkHistory}
            </View>
            <View style={{ width: columnWidth }}>{timeline}</View>
          </View>
        ) : (
          <>
            {checklist}
            {timeline}
            {checkHistory}
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
  historyRow: { paddingVertical: 6, gap: 1 },
  historyMeta: { fontSize: 11, fontVariant: ["tabular-nums"] },
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
  file: { paddingHorizontal: 16, paddingVertical: 10, gap: 2 },
  fileTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  fileTitle: { flex: 1, fontSize: 15, fontWeight: "600" },
  fileDate: { fontSize: 12, fontVariant: ["tabular-nums"] },
  fileDetail: { fontSize: 12.5 },
  fileName: { fontSize: 10.5 },
});
