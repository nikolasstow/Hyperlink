/**
 * The planner's runs, from the relay's Resin catalog: a list of runs with
 * what each changed, its check badges, and a render (RunsScreen), and one
 * run (RunScreen): its checks and metrics against its parent, its settings
 * diff, its renders, its prints, and its other settings.
 *
 * Every row has a fixed height, so the list never measures. Both pages ask
 * the relay again every 30 s while they are open.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { authedSource } from "../auth/serverTokens";
import { markTap, useOpenTiming } from "../perfMonitor";
import type { RootStackParamList } from "../RootNavigator";
import { SystemIcon } from "../SystemIcon";
import { useTextColors, useScreenBackground } from "../theme";
import { GroupedList, type Group } from "./GroupedList";
import { activeRoute, LIVE_REFRESH_MS, renderUrl, runRoute, runsRoute, useCatalog, type ActiveRun, type RunDetail, type RunSummary } from "./resinApi";
import { deltaOf, flagLabel, fmtMetric, fmtShortDate, metricLabel, renderLabel } from "./resinFormat";
import { ActiveRow, OutcomeChip, RenderTile, RUN_ROW_HEIGHT, RunRow } from "./RunParts";
import { relayBaseOf } from "./sdcp";
import { Card, CheckBadge, LCD, ListRow, CatalogProblem, Note, Row, usePalette } from "./ui";

type ListProps = NativeStackScreenProps<RootStackParamList, "ServerResinRuns">;
type RunProps = NativeStackScreenProps<RootStackParamList, "ServerResinRun">;

/** The note above a list while it loads or fails, at a fixed height. */
const TOP_NOTE_HEIGHT = 96;

/** The runs grouped by series, newest series first, each newest step first. */
const seriesOf = (runs: ReadonlyArray<RunSummary>): ReadonlyArray<{ readonly series: number; readonly runs: ReadonlyArray<RunSummary> }> => {
  const bySeries = new Map<number, Array<RunSummary>>();
  runs.forEach((run) => bySeries.set(run.series, [...(bySeries.get(run.series) ?? []), run]));
  return Array.from(bySeries.entries())
    .sort(([a], [b]) => b - a)
    .map(([series, list]) => ({ series, runs: [...list].sort((a, b) => b.step - a.step) }));
};

/** A row of the runs list: a run in progress (or just ended), or a run of the database. */
type ListRow = { readonly kind: "Active"; readonly run: ActiveRun } | { readonly kind: "Run"; readonly run: RunSummary };

const rowKey = (row: ListRow): string => (row.kind === "Active" ? `active-${row.run.number}` : row.run.id);

/** How many ended runs "Running now" keeps under the running ones. */
const RECENT = 3;

export const RunsScreen = (props: ListProps): React.ReactElement => {
  const background = useScreenBackground("grouped");
  useOpenTiming("ServerResinRuns");
  const text = useTextColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { serverName, serverAddress } = props.route.params;
  const relayBase = relayBaseOf(serverAddress);
  const runs = useCatalog(relayBase, runsRoute);
  const active = useCatalog(relayBase, activeRoute, LIVE_REFRESH_MS);
  // The rows count on between the relay's answers.
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const groups = React.useMemo((): ReadonlyArray<Group<ListRow>> => {
    const live = active.value?.runs ?? [];
    const running = live.filter((run) => run.running);
    const recent = live.filter((run) => !run.running).slice(0, RECENT);
    const liveGroup: ReadonlyArray<Group<ListRow>> =
      running.length + recent.length === 0
        ? []
        : [
            {
              key: "now",
              title: running.length > 0 ? "Running now" : "Ended recently",
              right: <Text style={[styles.seriesCount, { color: text.tertiaryLabel }]}>{running.length} running</Text>,
              rows: [...running, ...recent].map((run): ListRow => ({ kind: "Active", run })),
            },
          ];
    return [
      ...liveGroup,
      ...seriesOf(runs.value?.runs ?? []).map((group) => ({
        key: String(group.series),
        title: `Series ${group.series}`,
        right: <Text style={[styles.seriesCount, { color: text.tertiaryLabel }]}>{group.runs.length} runs</Text>,
        rows: group.runs.map((run): ListRow => ({ kind: "Run", run })),
      })),
    ];
  }, [runs.value, active.value, text.tertiaryLabel]);
  const openRun = (id: string): void => {
    markTap(`run ${id}`);
    props.navigation.navigate("ServerResinRun", { serverName, serverAddress, runId: id });
  };
  const showTop = runs.value === undefined || runs.error !== undefined || active.error !== undefined;
  return (
    <View style={[styles.root, { backgroundColor: background }]}>
      <GroupedList
        groups={groups}
        rowKey={rowKey}
        rowHeight={RUN_ROW_HEIGHT}
        width={Math.min(width - 32, 760)}
        bottomInset={insets.bottom}
        topHeight={showTop ? TOP_NOTE_HEIGHT : 0}
        top={
          showTop ? (
            runs.error !== undefined ? (
              <CatalogProblem error={runs.error} unreachable={runs.unreachable} />
            ) : (
              <Note text="Reading the runs…" />
            )
          ) : active.error !== undefined ? (
            <CatalogProblem error={`Runs in progress: ${active.error}`} unreachable={active.unreachable} />
          ) : null
        }
        renderRow={(row, last) => {
          if (row.kind === "Run") return <RunRow relayBase={relayBase} run={row.run} last={last} onPress={() => openRun(row.run.id)} />;
          const id = row.run.id;
          return <ActiveRow run={row.run} now={now} last={last} onPress={id === null ? undefined : () => openRun(id)} />;
        }}
      />
    </View>
  );
};

/** One render, full screen, with its caption. */
const RenderViewer = (props: { readonly relayBase: string; readonly runId: string; readonly name: string | undefined; readonly onClose: () => void }): React.ReactElement => {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={props.name !== undefined} animationType="fade" presentationStyle="fullScreen" supportedOrientations={["portrait", "landscape"]} onRequestClose={props.onClose}>
      <View style={styles.viewer}>
        {props.name !== undefined ? <Image source={authedSource(renderUrl(props.relayBase, props.runId, props.name, false))} style={StyleSheet.absoluteFill} resizeMode="contain" /> : null}
        <Text style={[styles.viewerCaption, { bottom: insets.bottom + 16 }]}>{props.name === undefined ? "" : renderLabel(props.name)}</Text>
        <Pressable style={[styles.close, { top: insets.top + 12 }]} hitSlop={10} onPress={props.onClose} accessibilityLabel="Close">
          <SystemIcon name="xmark" size={15} color="#ffffff" weight="bold" />
        </Pressable>
      </View>
    </Modal>
  );
};

/** One run's cards: one column on a phone, two on a wide screen. */
const RunBody = (props: {
  readonly run: RunDetail;
  readonly relayBase: string;
  readonly wide: boolean;
  readonly columnWidth: number;
  readonly tile: number;
  readonly openRun: (id: string) => void;
  readonly onRender: (name: string) => void;
}): React.ReactElement => {
  const text = useTextColors();
  const palette = usePalette();
  const { run, relayBase, wide, columnWidth, tile, openRun } = props;
  const setViewing = props.onRender;
        const summary = (
          <Card>
            <View style={styles.hero}>
              <View style={styles.heroThumb}>{run.render !== null ? <Image source={authedSource(renderUrl(relayBase, run.id, run.render, true))} style={styles.heroImage} resizeMode="cover" /> : null}</View>
              <View style={styles.heroText}>
                <Text style={[styles.heroTitle, { color: text.label }]} numberOfLines={2}>
                  {run.purpose ?? "No note of what changed"}
                </Text>
                <Text style={[styles.heroMeta, { color: text.secondaryLabel }]} numberOfLines={1}>
                  Series {run.series}, step {run.step}
                  {run.created !== null ? ` · ${fmtShortDate(run.created)}` : ""}
                </Text>
                <View style={styles.badges}>
                  {run.checks.map((check) => (
                    <CheckBadge key={check.key} label={check.label} passed={check.passed} />
                  ))}
                </View>
              </View>
            </View>
            <Text style={[styles.folder, { color: text.tertiaryLabel }]} numberOfLines={1}>
              {run.folder}
              {run.source !== null ? ` · source ${run.source}` : ""}
            </Text>
          </Card>
        );
        const family = (
          <Card title="Lineage" flush>
            {run.parent !== null ? (
              <ListRow icon="arrow.up.circle.fill" tint="#8E8E93" title={`Parent ${run.parent}`} detail={run.parentInferred ? "The step before it in the series" : "As the run database records it"} last={run.children.length === 0} onPress={() => openRun(run.parent ?? "")} />
            ) : null}
            {run.children.map((child, index) => (
              <ListRow key={child} icon="arrow.down.circle.fill" tint="#8E8E93" title={`Child ${child}`} detail="A run that changed this one" last={index === run.children.length - 1} onPress={() => openRun(child)} />
            ))}
            {run.parent === null && run.children.length === 0 ? (
              <View style={styles.pad}>
                <Note text="No parent and no child runs." />
              </View>
            ) : null}
          </Card>
        );
        const printed = (
          <Card title="Where it was printed">
            {run.prints.length === 0 ? (
              <Note text="The run database has no print of this run." />
            ) : (
              run.prints.map((print, index) => (
                <View key={`${print.id}-${print.head}`} style={[styles.printRow, index === run.prints.length - 1 ? null : styles.line]}>
                  <Text style={[styles.printId, { color: text.label }]}>
                    {print.id} · head {print.head}
                  </Text>
                  <OutcomeChip outcome={print.outcome} />
                </View>
              ))
            )}
          </Card>
        );
        const changes = (
          <Card title={run.parent === null ? "Settings diff" : `Settings against ${run.parent}`}>
            {run.command === null ? (
              <Note text="The run database has no command for this run." />
            ) : run.parent === null ? (
              <Note text="No parent run to compare with." />
            ) : run.changes.length === 0 ? (
              <Note text="The same flags as its parent." />
            ) : (
              run.changes.map((change, index) => (
                <View key={change.flag} style={[styles.diffRow, index === run.changes.length - 1 ? null : styles.line]}>
                  <Text style={[styles.diffFlag, { color: text.label }]} numberOfLines={1}>
                    {flagLabel(change.flag)}
                  </Text>
                  <Text style={[styles.diffOld, { color: text.tertiaryLabel }]} numberOfLines={1}>
                    {change.parent ?? "off"}
                  </Text>
                  <SystemIcon name="arrow.right" size={10} color={text.tertiaryLabel} />
                  <Text style={[styles.diffNew, { color: palette.accentInk }]} numberOfLines={1}>
                    {change.run ?? "off"}
                  </Text>
                </View>
              ))
            )}
          </Card>
        );
        const checks = (
          <Card title="Checks and metrics">
            {run.metrics.slice(0, 16).map((metric, index, shown) => {
              const delta = deltaOf(metric.value, metric.parent);
              return (
                <View key={metric.key} style={[styles.metricRow, index === shown.length - 1 ? null : styles.line]}>
                  <Text style={[styles.metricLabel, { color: text.secondaryLabel }]} numberOfLines={1}>
                    {metricLabel(metric.key)}
                  </Text>
                  {metric.parent !== null ? (
                    <Text style={[styles.metricParent, { color: text.tertiaryLabel }]} numberOfLines={1}>
                      {fmtMetric(metric.key, metric.parent)}
                    </Text>
                  ) : null}
                  <Text style={[styles.metricValue, { color: text.label }]} numberOfLines={1}>
                    {fmtMetric(metric.key, metric.value)}
                    {delta === "up" ? " ↑" : delta === "down" ? " ↓" : ""}
                  </Text>
                </View>
              );
            })}
            {run.metrics.length > 16 ? <Note text={`${run.metrics.length - 16} more metrics in the run database.`} /> : null}
          </Card>
        );
        const outputs = (
          <Card title="Outputs">
            {run.renders.length === 0 ? (
              <Note text="This run has no renders." />
            ) : (
              <View style={styles.grid}>
                {run.renders.map((name) => (
                  <RenderTile key={name} relayBase={relayBase} runId={run.id} name={name} size={tile} onPress={() => setViewing(name)} />
                ))}
              </View>
            )}
          </Card>
        );
        const settings =
          run.settings.length > 0 ? (
            <Card title="Every setting">
              {run.settings.map((setting, index) => (
                <Row key={`${setting.flag}-${index}`} label={flagLabel(setting.flag)} value={setting.value ?? "on"} last={index === run.settings.length - 1} />
              ))}
            </Card>
          ) : null;
        return wide ? (
          <View style={styles.columns}>
            <View style={{ width: columnWidth }}>
              {summary}
              {checks}
              {changes}
              {settings}
            </View>
            <View style={{ width: columnWidth }}>
              {outputs}
              {printed}
              {family}
            </View>
          </View>
        ) : (
          <>
            {summary}
            {checks}
            {changes}
            {outputs}
            {printed}
            {family}
            {settings}
          </>
        );
};

export const RunScreen = (props: RunProps): React.ReactElement => {
  useOpenTiming("ServerResinRun");
  const background = useScreenBackground("grouped");
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { serverName, serverAddress, runId } = props.route.params;
  const relayBase = relayBaseOf(serverAddress);
  const detail = useCatalog(relayBase, runRoute(runId));
  const [viewing, setViewing] = React.useState<string | undefined>(undefined);
  const wide = width >= 700;
  const contentWidth = Math.min(width - 32, 1100);
  const columnWidth = wide ? Math.floor((contentWidth - 14) / 2) : contentWidth;
  const tile = Math.floor((columnWidth - 32 - 20) / 3);


  const run = detail.value;
  const openRun = (id: string): void => props.navigation.push("ServerResinRun", { serverName, serverAddress, runId: id });

  const body =
    run === undefined ? (
      <Card>
        {detail.error !== undefined ? <CatalogProblem error={detail.error} unreachable={detail.unreachable} /> : <Note text="Reading the run…" />}
      </Card>
    ) : (
      <RunBody run={run} relayBase={relayBase} wide={wide} columnWidth={columnWidth} tile={tile} openRun={openRun} onRender={setViewing} />
    );

  return (
    <View style={[styles.root, { backgroundColor: background }]}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 40 }}>
        <View style={{ width: contentWidth, alignSelf: "center" }}>{body}</View>
      </ScrollView>
      <RenderViewer relayBase={relayBase} runId={runId} name={viewing} onClose={() => setViewing(undefined)} />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  headNote: { paddingHorizontal: 4, paddingBottom: 12 },
  series: { height: 34, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 4, paddingBottom: 6 },
  seriesText: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6 },
  seriesCount: { fontSize: 12 },
  hero: { flexDirection: "row", gap: 12 },
  heroThumb: { width: 96, height: 96, borderRadius: 14, overflow: "hidden", backgroundColor: LCD },
  heroImage: { width: 96, height: 96 },
  heroText: { flex: 1, gap: 4 },
  heroTitle: { fontSize: 17, fontWeight: "700", letterSpacing: -0.2 },
  heroMeta: { fontSize: 13 },
  badges: { flexDirection: "row", gap: 6, marginTop: 2 },
  folder: { fontSize: 11.5, marginTop: 10 },
  pad: { paddingHorizontal: 16, paddingVertical: 12 },
  line: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(127,127,127,0.3)" },
  printRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 9 },
  printId: { fontSize: 15, fontWeight: "600" },
  diffRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9 },
  diffFlag: { flex: 1, fontSize: 14 },
  diffOld: { maxWidth: 90, fontSize: 13, fontVariant: ["tabular-nums"] },
  diffNew: { maxWidth: 110, fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] },
  metricRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  metricLabel: { flex: 1, fontSize: 14 },
  metricParent: { width: 64, fontSize: 12.5, textAlign: "right", fontVariant: ["tabular-nums"] },
  metricValue: { width: 84, fontSize: 14, fontWeight: "600", textAlign: "right", fontVariant: ["tabular-nums"] },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  columns: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  viewer: { flex: 1, backgroundColor: "#000000" },
  viewerCaption: { position: "absolute", left: 0, right: 0, textAlign: "center", color: "rgba(255,255,255,0.8)", fontSize: 13 },
  close: { position: "absolute", right: 16, width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.55)" },
});

