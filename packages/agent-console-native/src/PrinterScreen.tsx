/**
 * The resin printer's home for a server: an Elegoo SDCP printer (Saturn 4
 * Ultra 16K) through that server's relay (saturn-uploader `relay`, port
 * 5197). It opens from the server's page, under Services.
 *
 * - The header: the printer's name, and its state in a glass pill.
 * - The print summary: a live thumbnail of the current layer, and the
 *   print's file, layer, progress, time left, end time, and settings. A tap
 *   opens the print page (printer/PrintScreen.tsx).
 * - The Printer card: the printer's own pages (details and health, local
 *   files, camera, network, settings).
 * - The Resin card: the catalog's pages (runs, library, print history) and
 *   the relay's engine jobs.
 *
 * This page holds the one live link to the printer (printer/usePrinterLink.ts)
 * and publishes it (printer/printerPageLink.ts). Every page it opens uses
 * that link and stays above it on the stack. When it opens, it loads what
 * those pages show (the print header, the layer pack, the catalog), so a
 * tap only renders.
 *
 * See docs/handoffs/elegoo-printer-plugin.md.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { mark } from "./diagnostics/launchTrail";
import { markTap } from "./perfMonitor";
import { useLayerPack } from "./printer/layerPack";
import { useRunningUploads, useUploadWatch } from "./printer/PrinterFiles";
import { fmtDuration, healthItems } from "./printer/printerFormat";
import { usePublishPrinterLink } from "./printer/printerPageLink";
import { useLoadedUri } from "./printer/PrinterStage";
import { usePrintHeader } from "./printer/printHeader";
import { linkChip, statusOf } from "./printer/printStatus";
import { historyRoute, libraryRoute, originRoute, runsRoute, useCatalog } from "./printer/resinApi";
import { describeFile } from "./printer/resinFormat";
import { isPrinting, layerIndexOf, PHASE_EXPOSING, PHASE_PAUSED } from "./printer/sdcp";
import { CatalogProblem, Card, Chip, LCD, ListRow, usePalette } from "./printer/ui";
import { usePrinterLink, type PrinterLink } from "./printer/usePrinterLink";
import { authedSource } from "./auth/serverTokens";
import type { RootStackParamList } from "./RootNavigator";
import { SystemIcon } from "./SystemIcon";
import { useTextColors, withAlpha, useScreenBackground } from "./theme";

type Props = NativeStackScreenProps<RootStackParamList, "ServerPrinter">;

/** The summary card's thumbnail: the LCD's shape (about 16:9), at a fixed size. */
const THUMB_WIDTH = 132;
const THUMB_HEIGHT = 74;

/** The row tints, as in iOS Settings. */
const TINT = {
  health: "#FF2D55",
  files: "#0A84FF",
  camera: "#5E5CE6",
  network: "#30B0C7",
  settings: "#8E8E93",
  runs: "#AF52DE",
  library: "#FF9500",
  history: "#34C759",
  jobs: "#5856D6",
} as const;

export const PrinterScreen = (props: Props): React.ReactElement => {
  const background = useScreenBackground("grouped");
  const text = useTextColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { navigation } = props;
  // `?.` guards a nav state restored before this screen took params.
  const serverAddress = props.route.params?.serverAddress ?? "";
  const serverName = props.route.params?.serverName ?? "";
  const printer = usePrinterLink(serverAddress);
  usePublishPrinterLink(serverAddress, printer);
  const runningUploads = useRunningUploads();
  useUploadWatch(printer.relayBase, printer.relayReachable);
  // The launch trail: the printer page is the suspect in a launch that dies.
  React.useEffect(() => {
    mark("printer page mounted");
    return () => mark("printer page unmounted");
  }, []);
  const linkStep = `printer link: ${printer.link.kind}${printer.link.kind === "Open" ? ` via ${printer.link.via}` : ""}`;
  React.useEffect(() => {
    mark(linkStep);
  }, [linkStep]);
  // The spinner is for the first try only, so a page that keeps retrying does not swap between the spinner and the cards.
  const [tried, setTried] = React.useState(false);
  if (!tried && printer.link.kind !== "Connecting") setTried(true);

  const status = printer.status;
  const info = status?.PrintInfo;
  const online = printer.link.kind === "Open";
  const hasJob = info?.TaskId !== undefined && info.TaskId !== "" && info.Filename !== undefined && info.Filename !== "";

  // Loaded now, so the pages this one opens have it when the owner taps.
  usePrintHeader(printer.relayBase, hasJob ? info?.TaskId : undefined, printer.relayReachable);
  const runs = useCatalog(printer.relayBase, runsRoute);
  const library = useCatalog(printer.relayBase, libraryRoute);
  const history = useCatalog(printer.relayBase, historyRoute);
  useCatalog(printer.relayBase, hasJob && info?.Filename !== undefined ? originRoute(info.Filename) : undefined);

  const health = healthItems(printer.attributes?.DevicesStatus);
  const healthBad = health.filter((item) => !item.ok).length;
  const name = printer.attributes?.Name ?? "Printer";

  React.useLayoutEffect(() => {
    navigation.setOptions({
      title: name,
    });
  }, [navigation, name]);

  const open = (route: "ServerPrinterHealth" | "ServerPrinterFiles" | "ServerPrinterCamera" | "ServerPrinterNetwork" | "ServerPrinterSettings" | "ServerResinRuns" | "ServerResinLibrary" | "ServerResinHistory" | "ServerSupportJobs" | "ServerPrint"): void => {
      // Opens at once: the page reads what this page has loaded, and loads the rest itself.
      markTap(route);
      navigation.navigate(route, { serverName, serverAddress });
    };

  const link = linkChip(printer.link);
  const connection = online ? (printer.link.kind === "Open" && printer.link.via === "Direct" ? `Direct to the printer at ${printer.printerIp ?? "its address"}` : `Through the relay on ${serverName || "the server"}`) : "Not connected";
  const wide = width >= 700;
  const catalogDown = [runs, library, history].find((loaded) => loaded.error !== undefined);

  const printerCard = (
    <Card title="Printer" flush>
      <ListRow
        icon="heart.text.square.fill"
        tint={TINT.health}
        title="Details & health"
        detail={health.length === 0 ? "Vitals, release film, and self-check" : healthBad === 0 ? "Self-check: all normal" : `Self-check: ${healthBad} to check`}
        badge={healthBad}
        onPress={() => open("ServerPrinterHealth")}
      />
      <ListRow icon="folder.fill" tint={TINT.files} title="Local files" detail="On the printer and its USB drive" badge={runningUploads} onPress={() => open("ServerPrinterFiles")} />
      <ListRow icon="video.fill" tint={TINT.camera} title="Camera" detail="The live feed" onPress={() => open("ServerPrinterCamera")} />
      <ListRow icon="wifi" tint={TINT.network} title="Network" detail="Signal and drops over time" onPress={() => open("ServerPrinterNetwork")} />
      <ListRow icon="gearshape.fill" tint={TINT.settings} title="Settings" detail="Stage, connection, camera lock, relay access" last onPress={() => open("ServerPrinterSettings")} />
    </Card>
  );

  const resinCard = (
    <Card title="Resin" flush>
      <ListRow icon="flask.fill" tint={TINT.runs} title="Runs" detail="What each run changed, and its checks" value={runs.value === undefined ? undefined : runs.value.runs.length.toLocaleString()} onPress={() => open("ServerResinRuns")} />
      <ListRow icon="books.vertical.fill" tint={TINT.library} title="Library" detail="Print files by what they are" value={library.value === undefined ? undefined : library.value.files.length.toLocaleString()} onPress={() => open("ServerResinLibrary")} />
      <ListRow icon="clock.arrow.circlepath" tint={TINT.history} title="Print history" detail="Every print, its outcome, and notes" value={history.value === undefined ? undefined : history.value.prints.length.toLocaleString()} onPress={() => open("ServerResinHistory")} />
      <ListRow icon="cpu" tint={TINT.jobs} title="Engine & jobs" detail="Support jobs on the relay" last onPress={() => open("ServerSupportJobs")} />
      {catalogDown?.error !== undefined ? (
        <View style={styles.cardNote}>
          <CatalogProblem error={catalogDown.error} unreachable={catalogDown.unreachable} />
        </View>
      ) : null}
    </Card>
  );

  return (
    <View style={[styles.root, { backgroundColor: background }]}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 40 }}>
        {status === undefined && !tried ? (
          <ActivityIndicator style={styles.loading} />
        ) : (
          <View style={styles.narrow}>
            <PrintSummary printer={printer} onPress={() => open("ServerPrint")} />
            {wide ? (
              <View style={styles.columns}>
                <View style={styles.column}>{printerCard}</View>
                <View style={styles.column}>{resinCard}</View>
              </View>
            ) : (
              <>
                {printerCard}
                {resinCard}
              </>
            )}
            {printer.notice !== undefined ? <Text style={[styles.foot, { color: text.tertiaryLabel }]}>{printer.notice}</Text> : null}
            <View style={styles.footRow}>
              <Chip tone={link.tone} label={link.label} onPress={printer.reconnect} />
              <Text style={[styles.foot, { color: text.tertiaryLabel }]}>
                {connection}
                {printer.updatedAt !== undefined ? ` · updated ${new Date(printer.updatedAt).toLocaleTimeString()}` : ""}
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

/**
 * The print summary: the current layer, live, on the left, and the print's
 * details beside it. The time left counts on between the printer's pushes.
 */
const PrintSummary = (props: { readonly printer: PrinterLink; readonly onPress: () => void }): React.ReactElement => {
  const { printer } = props;
  const text = useTextColors();
  const palette = usePalette();
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const status = printer.status;
  const info = status?.PrintInfo;
  const online = printer.link.kind === "Open";
  const hasJob = info?.TaskId !== undefined && info.TaskId !== "" && info.Filename !== undefined && info.Filename !== "";
  const active = hasJob && isPrinting(status);
  const paused = active && info?.Status === PHASE_PAUSED;
  const exposing = active && info?.Status === PHASE_EXPOSING;
  const total = info?.TotalLayer ?? 0;
  const current = info?.CurrentLayer ?? 0;
  const index = hasJob && total > 0 ? layerIndexOf(current, total) : undefined;
  const percent = total > 0 ? (current / total) * 100 : 0;
  const sincePush = active && !paused && printer.updatedAt !== undefined ? now - printer.updatedAt : 0;
  const remaining = info?.TotalTicks !== undefined && info.CurrentTicks !== undefined ? info.TotalTicks - info.CurrentTicks - sincePush : undefined;
  const taskId = hasJob ? info?.TaskId : undefined;
  const { header } = usePrintHeader(printer.relayBase, taskId, printer.relayReachable);
  const origin = useCatalog(printer.relayBase, hasJob && info?.Filename !== undefined ? originRoute(info.Filename) : undefined);
  // The small layer from the pack on the phone at once; the relay's image of this layer once it has loaded.
  const pack = useLayerPack(printer.relayReachable ? printer.relayBase : undefined, taskId);
  const relayLayer = printer.relayReachable && taskId !== undefined && index !== undefined ? `${printer.relayBase}/api/prints/${encodeURIComponent(taskId)}/layers/${index}.png?alpha=1&scale=16` : undefined;
  const loaded = useLoadedUri(relayLayer);
  const layerUri = pack.uriOf(index) ?? loaded;
  const identity = hasJob && info?.Filename !== undefined ? describeFile(info.Filename, origin.value?.print) : undefined;
  const state = statusOf(status, online);
  const endsAt = active && !paused && remaining !== undefined ? new Date(now + remaining) : undefined;
  const settings = header === undefined ? undefined : [`${header.exposureSeconds} s`, `${Math.round(header.layerHeightMm * 1000)} µm`, `${header.volumeMl.toFixed(1)} ml`].join(" · ");

  return (
    <Pressable onPress={props.onPress} accessibilityRole="button" accessibilityLabel="Open the print" style={({ pressed }) => [pressed && styles.pressed]}>
      <Card>
        <View style={styles.summary}>
          <View style={[styles.thumb, exposing ? { shadowColor: palette.accent, shadowOpacity: 0.7, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } } : null]}>
            {layerUri !== undefined && hasJob ? (
              <Image source={authedSource(layerUri)} style={styles.thumbImage} resizeMode="contain" tintColor={exposing ? palette.accentInk : withAlpha(palette.accentInk, 0.75)} />
            ) : (
              <Text style={styles.thumbNote}>{hasJob ? "Loading" : "Idle"}</Text>
            )}
          </View>
          <View style={styles.details}>
            <View style={styles.statusRow}>
              <Chip tone={state.tone} label={active && !paused ? `${state.label} ${Math.floor(percent)}%` : state.label} />
            </View>
            <Text style={[styles.title, { color: text.label }]} numberOfLines={1}>
              {identity?.title ?? (online ? "Ready for a print" : status === undefined ? "Connecting…" : "Printer not reachable")}
            </Text>
            {identity?.detail !== undefined ? (
              <Text style={[styles.detail, { color: palette.accentInk }]} numberOfLines={1}>
                {identity.detail}
              </Text>
            ) : null}
            {hasJob ? (
              <Text style={[styles.line, { color: text.secondaryLabel }]} numberOfLines={1}>
                Layer {current.toLocaleString()}/{total.toLocaleString()} · {Math.floor(percent)}%
              </Text>
            ) : null}
          </View>
          <SystemIcon name="chevron.right" size={13} color={text.tertiaryLabel} weight="semibold" />
        </View>
        {hasJob ? (
          <>
            <View style={[styles.track, { backgroundColor: withAlpha("#7F7F7F", 0.2) }]}>
              <View style={[styles.fill, { width: `${Math.min(100, percent)}%`, backgroundColor: palette.accent }]} />
            </View>
            <View style={styles.facts}>
              <Fact label="Left" value={active ? fmtDuration(remaining) : "—"} />
              <Fact label="Ends" value={endsAt === undefined ? "—" : endsAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} />
              <Fact label="Settings" value={settings ?? "—"} wide />
            </View>
            {info?.Filename !== undefined ? (
              <Text style={[styles.fileName, { color: text.tertiaryLabel }]} numberOfLines={1}>
                {info.Filename}
              </Text>
            ) : null}
          </>
        ) : null}
      </Card>
    </Pressable>
  );
};

const Fact = (props: { readonly label: string; readonly value: string; readonly wide?: boolean }): React.ReactElement => {
  const text = useTextColors();
  return (
    <View style={props.wide === true ? styles.factWide : styles.fact}>
      <Text style={[styles.factLabel, { color: text.tertiaryLabel }]}>{props.label.toUpperCase()}</Text>
      <Text style={[styles.factValue, { color: text.label }]} numberOfLines={1}>
        {props.value}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { paddingVertical: 60 },
  narrow: { width: "100%", maxWidth: 1100, alignSelf: "center" },
  columns: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  column: { flex: 1 },
  pressed: { opacity: 0.75 },
  summary: { flexDirection: "row", alignItems: "center", gap: 12 },
  thumb: { width: THUMB_WIDTH, height: THUMB_HEIGHT, borderRadius: 12, backgroundColor: LCD, alignItems: "center", justifyContent: "center" },
  thumbImage: { width: THUMB_WIDTH, height: THUMB_HEIGHT, borderRadius: 12 },
  thumbNote: { color: "rgba(244,245,249,0.5)", fontSize: 11 },
  details: { flex: 1 },
  statusRow: { flexDirection: "row", marginBottom: 4 },
  title: { fontSize: 16, fontWeight: "700", letterSpacing: -0.2, marginTop: 1 },
  detail: { fontSize: 12.5, fontWeight: "600", marginTop: 1 },
  line: { fontSize: 12.5, marginTop: 2, fontVariant: ["tabular-nums"] },
  track: { height: 4, borderRadius: 2, overflow: "hidden", marginTop: 12 },
  fill: { height: 4, borderRadius: 2 },
  facts: { flexDirection: "row", gap: 12, marginTop: 10 },
  fact: { width: 64 },
  factWide: { flex: 1 },
  factLabel: { fontSize: 9.5, fontWeight: "700", letterSpacing: 0.5 },
  factValue: { fontSize: 13, fontWeight: "600", marginTop: 1, fontVariant: ["tabular-nums"] },
  fileName: { fontSize: 11, marginTop: 8 },
  cardNote: { paddingHorizontal: 16, paddingVertical: 10 },
  footRow: { alignItems: "center", gap: 6, marginTop: 4 },
  foot: { fontSize: 11, textAlign: "center" },
});
