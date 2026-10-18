/**
 * The resin printer page for a server: live status of an Elegoo SDCP printer
 * (Saturn 4 Ultra 16K) and the image of the layer on its LCD right now.
 *
 * The page connects straight to the printer when the phone is on the same
 * LAN, and through the relay on the server (saturn-uploader `relay`, port
 * 5197) when it is not. See `printer/usePrinterLink.ts`. Pause, resume, and
 * stop work either way; each asks for confirmation first, and stop cannot be
 * undone.
 *
 * The layer image is an alpha mask, tinted UV violet here. It
 * glows while the printer exposes the layer and dims while it lifts and
 * drops.
 *
 * A server page like UPS; later a plugin contribution with a Home widget.
 * See docs/handoffs/elegoo-printer-plugin.md.
 *
 * @internal
 */
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { ActivityIndicator, Alert, Animated, Image, Pressable, ScrollView, StyleSheet, Text, useColorScheme, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CMD_PAUSE, CMD_RESUME, CMD_STOP, controlAckLabel, isPrinting, layerIndexOf, machineLabel, PHASE_COMPLETE, PHASE_EXPOSING, PHASE_PAUSED, PHASE_PAUSING, PHASE_STOPPING, phaseLabel, PRINTER_PORT, type ControlCmd, type PrintInfo } from "./printer/sdcp";
import { useDirectLayer } from "./printer/directLayers";
import { usePrinterLink, type LinkState } from "./printer/usePrinterLink";
import type { RootStackParamList } from "./RootNavigator";
import { type TextColors, useScreenBackground, useThemedStyles } from "./theme";

type Props = NativeStackScreenProps<RootStackParamList, "ServerPrinter">;

const UV = "#a98bff";
const UV_GLOW = "#8f6bff";
const GREEN = "#32d74b";
const RED = "#ff453a";
const AMBER = "#ffd60a";
const LCD = "#050507";
const TRACK = "rgba(142,147,163,0.2)";

const fmtDuration = (ms: number | undefined): string => {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`;
};

const linkPill = (link: LinkState): { readonly label: string; readonly color: string } => {
  switch (link.kind) {
    case "Open":
      return link.via === "Direct" ? { label: "DIRECT", color: GREEN } : { label: "RELAY", color: UV };
    case "Connecting":
      return { label: "CONNECTING", color: AMBER };
    case "Offline":
      return { label: "OFFLINE", color: RED };
  }
};

/**
 * Shows the newest layer image only once it has loaded, so the LCD never
 * flashes empty between layers. `uri` changes once per layer (about every
 * six seconds on a 16K printer).
 */
const useLoadedUri = (uri: string | undefined): string | undefined => {
  const [shown, setShown] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    if (uri === undefined) return;
    let alive = true;
    void Image.prefetch(uri)
      .then((ok) => {
        if (alive && ok) setShown(uri);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [uri]);
  return shown;
};

/** The printer's LCD: black glass with the current layer lit in UV violet. */
const Lcd = (props: { readonly uri: string | undefined; readonly exposing: boolean; readonly phase: string; readonly index: number | undefined; readonly note: string | undefined; readonly width: number }): React.ReactElement => {
  const [aspect, setAspect] = React.useState(15120 / 6230);
  const glow = React.useRef(new Animated.Value(props.exposing ? 1 : 0)).current;
  React.useEffect(() => {
    Animated.timing(glow, { toValue: props.exposing ? 1 : 0, duration: 280, useNativeDriver: true }).start();
  }, [glow, props.exposing]);
  const innerW = props.width - 36;
  const height = Math.min(Math.max(innerW / aspect, 150), 420);
  return (
    <View style={[styles2.lcd, { minHeight: height + 36 }]}>
      <View style={styles2.lcdBadgeRow}>
        <Text style={[styles2.badge, props.exposing ? styles2.badgeLit : null]}>{props.phase.toUpperCase()}</Text>
        {props.index !== undefined ? <Text style={styles2.corner}>#{props.index}</Text> : null}
      </View>
      {props.uri === undefined ? (
        <Text style={styles2.lcdNote}>{props.note ?? "Waiting for the printer…"}</Text>
      ) : (
        <Animated.View
          style={{
            opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.32, 1] }),
            shadowColor: UV_GLOW,
            shadowOpacity: 0.9,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 0 },
          }}
        >
          <Image
            source={{ uri: props.uri }}
            style={{ width: Math.min(innerW, height * aspect), height: Math.min(height, innerW / aspect) }}
            resizeMode="contain"
            tintColor={UV}
            onLoad={(event) => {
              const { width, height: h } = event.nativeEvent.source;
              if (width > 0 && h > 0) setAspect(width / h);
            }}
          />
        </Animated.View>
      )}
    </View>
  );
};

export const PrinterScreen = (props: Props): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const background = useScreenBackground("grouped");
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { width } = useWindowDimensions();
  // `?.` guards a nav state restored before this screen took params.
  const serverAddress = props.route.params?.serverAddress;
  const printer = usePrinterLink(serverAddress);
  const [mirror, setMirror] = React.useState(false);
  // Re-render every second so elapsed time and "done at" move between pushes.
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const status = printer.status;
  const attributes = printer.attributes;
  const info: PrintInfo | undefined = status?.PrintInfo;
  const printing = isPrinting(status);
  const total = info?.TotalLayer ?? 0;
  const current = info?.CurrentLayer ?? 0;
  const index = info?.TaskId !== undefined && total > 0 ? layerIndexOf(current, total) : undefined;
  const exposing = printing && info?.Status === PHASE_EXPOSING;
  const phase = printing ? phaseLabel(info?.Status) : info?.Status === PHASE_COMPLETE ? "Complete" : "Idle";
  const percent = total > 0 ? (current / total) * 100 : 0;
  const remaining = info?.TotalTicks !== undefined && info.CurrentTicks !== undefined ? info.TotalTicks - info.CurrentTicks : undefined;
  // Ticks only arrive with a push; between pushes, count on from the last one.
  const sincePush = printing && printer.updatedAt !== undefined ? now - printer.updatedAt : 0;

  // On the LAN the page reads the print file from the printer and decodes the layer itself;
  // the relay draws it only when the phone is away from home.
  const direct = printer.link.kind === "Open" && printer.link.via === "Direct" && printer.printerIp !== undefined;
  const printerBase = printer.printerIp === undefined ? undefined : `http://${printer.printerIp}:${PRINTER_PORT}`;
  const directLayer = useDirectLayer(
    direct && printerBase !== undefined && info?.TaskId !== undefined && info.Filename !== undefined && index !== undefined
      ? { printerBase, filename: info.Filename, taskId: info.TaskId, index, totalLayers: total, mirror }
      : undefined,
  );
  const taskBase = info?.TaskId === undefined ? undefined : `${printer.relayBase}/api/prints/${encodeURIComponent(info.TaskId)}`;
  const relayLayerUri = !direct && taskBase !== undefined && index !== undefined && printer.relayReachable ? `${taskBase}/layers/${index}.png?alpha=1&crop=1&scale=8&mirror=${mirror ? 1 : 0}` : undefined;
  const relayShownUri = useLoadedUri(relayLayerUri);
  const shownUri = direct ? directLayer.uri : relayShownUri;
  const thumbUri =
    info?.TaskId === undefined
      ? undefined
      : direct && printerBase !== undefined
        ? `${printerBase}/media/mmcblk0p1/history_image/${encodeURIComponent(info.TaskId)}.bmp`
        : taskBase !== undefined
          ? `${taskBase}/thumbnail.bmp`
          : undefined;
  const previewUri = direct ? directLayer.previewUri : taskBase !== undefined && printer.relayReachable ? `${taskBase}/preview.png` : undefined;
  const lcdNote = direct
    ? directLayer.progress !== undefined
      ? `Reading the layer index from the printer (once per print): ${directLayer.progress.indexed.toLocaleString()} / ${directLayer.progress.target.toLocaleString()}`
      : directLayer.error !== undefined
        ? `Could not read the layer: ${directLayer.error}`
        : "Reading the layer from the printer…"
    : printer.relayReachable
      ? undefined
      : "Away from home, layer images come from the relay on the server, which is not reachable.";

  const pill = linkPill(printer.link);
  const cardW = width - 32;

  return (
    <ScrollView style={{ backgroundColor: background }} contentInsetAdjustmentBehavior="never" contentContainerStyle={{ padding: 16, paddingTop: headerHeight + 8, paddingBottom: insets.bottom + 48 }}>
      <View style={styles.top}>
        <View style={styles.topText}>
          <Text style={styles.h1} numberOfLines={1}>
            {attributes?.Name ?? "Resin printer"}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {info?.Filename ?? attributes?.MachineName ?? "—"}
          </Text>
        </View>
        <Pressable onPress={printer.reconnect} style={[styles.pill, { backgroundColor: `${pill.color}29` }]}>
          <Text style={[styles.pillText, { color: pill.color }]}>{pill.label}</Text>
        </Pressable>
      </View>

      {status === undefined ? (
        <View style={styles.loading}>{printer.link.kind === "Offline" ? <Text style={styles.offline}>Can’t reach the printer or the relay.</Text> : <ActivityIndicator />}</View>
      ) : (
        <>
          <Lcd uri={shownUri} exposing={exposing} phase={phase} index={index} note={lcdNote} width={cardW} />

          <View style={styles.layerRow}>
            <Text style={styles.big}>{current.toLocaleString()}</Text>
            <Text style={styles.of}> / {total.toLocaleString()}</Text>
            <View style={styles.spacer} />
            <Text style={styles.percent}>{percent.toFixed(1)}%</Text>
          </View>
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${Math.min(100, percent)}%` }]} />
          </View>

          <View style={styles.statGrid}>
            <Stat styles={styles} label="Elapsed" value={fmtDuration(info?.CurrentTicks === undefined ? undefined : info.CurrentTicks + sincePush)} />
            <Stat styles={styles} label="Remaining" value={printing ? fmtDuration(remaining === undefined ? undefined : remaining - sincePush) : "—"} />
            <Stat styles={styles} label="Done at" value={printing && remaining !== undefined ? new Date(printer.updatedAt === undefined ? now + remaining : printer.updatedAt + remaining).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"} />
            <Stat styles={styles} label="Machine" value={(status.CurrentStatus ?? []).map(machineLabel).join(", ") || "—"} />
          </View>

          {printing ? <Controls styles={styles} phase={info?.Status} send={printer.sendControl} /> : null}

          <Pressable onPress={() => setMirror((m) => !m)} style={styles.toggle}>
            <Text style={styles.toggleText}>{mirror ? "Showing as on the LCD (mirrored)" : "Showing as sliced"}</Text>
            <Text style={styles.toggleAction}>{mirror ? "Unmirror" : "Mirror"}</Text>
          </Pressable>

          <Text style={styles.sectionLabel}>Print</Text>
          <GlassView style={styles.card} glassEffectStyle="regular" colorScheme={scheme}>
            <View style={styles.thumbs}>
              <Thumb styles={styles} uri={previewUri} label="Slicer preview" />
              <Thumb styles={styles} uri={thumbUri} label="Printer thumbnail" />
            </View>
          </GlassView>

          <Text style={styles.sectionLabel}>Printer</Text>
          <GlassView style={styles.card} glassEffectStyle="regular" colorScheme={scheme}>
            <Row styles={styles} label="UV LED" value={status.TempOfUVLED !== undefined ? `${status.TempOfUVLED.toFixed(1)} °C` : "—"} />
            <Row styles={styles} label="Resin tank" value={status.TempOfTank !== undefined ? `${status.TempOfTank} °C${status.TempTargetTank ? ` → ${status.TempTargetTank} °C` : ""}` : "—"} />
            <Row
              styles={styles}
              label="Release film"
              value={status.ReleaseFilm !== undefined && attributes?.ReleaseFilmMax ? `${status.ReleaseFilm.toLocaleString()} / ${attributes.ReleaseFilmMax.toLocaleString()}` : "—"}
              warn={status.ReleaseFilm !== undefined && attributes?.ReleaseFilmMax !== undefined && status.ReleaseFilm >= attributes.ReleaseFilmMax}
            />
            <Row styles={styles} label="Camera" value={attributes?.CameraStatus === 1 ? `${attributes.NumberOfVideoStreamConnected ?? 0}/${attributes.MaximumVideoStreamAllowed ?? "?"} streams` : "None"} />
            <Row styles={styles} label="Firmware" value={attributes?.FirmwareVersion ?? "—"} />
            <Row styles={styles} label="Address" value={printer.printerIp ?? "—"} last />
          </GlassView>

          {printer.notice !== undefined ? <Text style={styles.foot}>{printer.notice}</Text> : null}
          <Text style={styles.foot}>
            {printer.link.kind === "Open" ? (printer.link.via === "Direct" ? `direct to ${printer.printerIp ?? "printer"}` : `through the relay on ${props.route.params?.serverName ?? "the server"}`) : "not connected"}
            {printer.updatedAt !== undefined ? ` · updated ${new Date(printer.updatedAt).toLocaleTimeString()}` : ""}
          </Text>
        </>
      )}
    </ScrollView>
  );
};

const CONFIRM: Record<ControlCmd, { readonly title: string; readonly message: string; readonly action: string; readonly destructive: boolean }> = {
  [CMD_PAUSE]: { title: "Pause the print?", message: "The printer finishes the current layer and lifts. It takes about a minute to settle.", action: "Pause", destructive: false },
  [CMD_RESUME]: { title: "Resume the print?", message: "The printer continues from the layer where it paused.", action: "Resume", destructive: false },
  [CMD_STOP]: { title: "Stop the print?", message: "The print ends and cannot be resumed.", action: "Stop Print", destructive: true },
};

/**
 * Pause or resume, and stop, for a running print. Each asks first. While the
 * printer is pausing or stopping the buttons wait, because a second command
 * then gets a "busy" ack.
 */
const Controls = (props: { readonly styles: ReturnType<typeof makeStyles>; readonly phase: number | undefined; readonly send: (cmd: ControlCmd) => Promise<number> }): React.ReactElement => {
  const [busy, setBusy] = React.useState<ControlCmd | undefined>(undefined);
  const paused = props.phase === PHASE_PAUSED;
  const settling = props.phase === PHASE_PAUSING || props.phase === PHASE_STOPPING;
  const run = (cmd: ControlCmd): void => {
    const confirm = CONFIRM[cmd];
    Alert.alert(confirm.title, confirm.message, [
      { text: "Cancel", style: "cancel" },
      {
        text: confirm.action,
        style: confirm.destructive ? "destructive" : "default",
        onPress: () => {
          setBusy(cmd);
          props
            .send(cmd)
            .then((ack) => {
              if (ack !== 0) Alert.alert(`${confirm.action} failed`, controlAckLabel(ack));
            })
            .catch((error: unknown) => Alert.alert(`${confirm.action} failed`, error instanceof Error ? error.message : String(error)))
            .finally(() => setBusy(undefined));
        },
      },
    ]);
  };
  const toggleCmd = paused ? CMD_RESUME : CMD_PAUSE;
  const disabled = busy !== undefined || settling;
  return (
    <View style={props.styles.controls}>
      <Pressable disabled={disabled} onPress={() => run(toggleCmd)} style={[props.styles.control, disabled ? props.styles.controlOff : null]}>
        {busy === toggleCmd ? <ActivityIndicator color={UV} /> : <Text style={[props.styles.controlText, { color: UV }]}>{settling && props.phase === PHASE_PAUSING ? "Pausing…" : paused ? "Resume" : "Pause"}</Text>}
      </Pressable>
      <Pressable disabled={disabled} onPress={() => run(CMD_STOP)} style={[props.styles.control, props.styles.controlStop, disabled ? props.styles.controlOff : null]}>
        {busy === CMD_STOP ? <ActivityIndicator color={RED} /> : <Text style={[props.styles.controlText, { color: RED }]}>{props.phase === PHASE_STOPPING ? "Stopping…" : "Stop"}</Text>}
      </Pressable>
    </View>
  );
};

const Stat = (props: { readonly styles: ReturnType<typeof makeStyles>; readonly label: string; readonly value: string }): React.ReactElement => (
  <View style={props.styles.statCell}>
    <Text style={props.styles.statV} numberOfLines={1}>
      {props.value}
    </Text>
    <Text style={props.styles.statK}>{props.label}</Text>
  </View>
);

const Row = (props: { readonly styles: ReturnType<typeof makeStyles>; readonly label: string; readonly value: string; readonly warn?: boolean; readonly last?: boolean }): React.ReactElement => (
  <View style={[props.styles.row, props.last ? props.styles.rowLast : null]}>
    <Text style={props.styles.rowLabel}>{props.label}</Text>
    <Text style={[props.styles.rowValue, props.warn ? { color: AMBER } : null]} numberOfLines={1}>
      {props.value}
    </Text>
  </View>
);

const Thumb = (props: { readonly styles: ReturnType<typeof makeStyles>; readonly uri: string | undefined; readonly label: string }): React.ReactElement => (
  <View style={props.styles.thumb}>
    <View style={props.styles.thumbFrame}>{props.uri !== undefined ? <Image source={{ uri: props.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" /> : null}</View>
    <Text style={props.styles.thumbLabel}>{props.label}</Text>
  </View>
);

// The LCD is always dark, whatever the app's theme: it shows the printer's screen.
const styles2 = StyleSheet.create({
  lcd: { backgroundColor: LCD, borderRadius: 20, padding: 18, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  lcdBadgeRow: { position: "absolute", top: 12, left: 12, right: 12, flexDirection: "row", justifyContent: "space-between", zIndex: 1 },
  badge: { color: "#9a9ab0", fontSize: 11, fontWeight: "700", letterSpacing: 0.6, backgroundColor: "rgba(255,255,255,0.06)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: "hidden" },
  badgeLit: { color: "#e0d6ff", backgroundColor: "rgba(124,92,255,0.28)" },
  corner: { color: "#8d8da6", fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] },
  lcdNote: { color: "#7a7a90", fontSize: 13, textAlign: "center", paddingHorizontal: 24 },
});

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12 },
    topText: { flex: 1 },
    h1: { color: text.label, fontSize: 22, fontWeight: "700" },
    sub: { color: text.secondaryLabel, fontSize: 13, marginTop: 2 },
    pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
    pillText: { fontSize: 13, fontWeight: "700" },
    loading: { paddingVertical: 60, alignItems: "center" },
    offline: { color: text.secondaryLabel, fontSize: 14, textAlign: "center" },
    layerRow: { flexDirection: "row", alignItems: "baseline", marginTop: 16, marginBottom: 8 },
    big: { color: text.label, fontSize: 34, fontWeight: "800", fontVariant: ["tabular-nums"] },
    of: { color: text.secondaryLabel, fontSize: 17, fontWeight: "600", fontVariant: ["tabular-nums"] },
    spacer: { flex: 1 },
    percent: { color: text.secondaryLabel, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
    bar: { height: 8, borderRadius: 4, backgroundColor: TRACK, overflow: "hidden" },
    barFill: { height: 8, borderRadius: 4, backgroundColor: UV },
    statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },
    statCell: { width: "47%", flexGrow: 1, backgroundColor: "rgba(127,127,127,0.1)", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 12 },
    statV: { color: text.label, fontSize: 19, fontWeight: "800", fontVariant: ["tabular-nums"] },
    statK: { color: text.secondaryLabel, fontSize: 11, fontWeight: "600", marginTop: 2, textTransform: "uppercase", letterSpacing: 0.3 },
    controls: { flexDirection: "row", gap: 10, marginTop: 14 },
    control: { flex: 1, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(169,139,255,0.16)" },
    controlStop: { backgroundColor: "rgba(255,69,58,0.14)" },
    controlOff: { opacity: 0.45 },
    controlText: { fontSize: 16, fontWeight: "700" },
    toggle: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12, paddingVertical: 8, paddingHorizontal: 4 },
    toggleText: { color: text.secondaryLabel, fontSize: 13 },
    toggleAction: { color: UV, fontSize: 14, fontWeight: "600" },
    sectionLabel: { color: text.secondaryLabel, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3, marginLeft: 2, marginBottom: 8, marginTop: 18 },
    card: { borderRadius: 18, paddingHorizontal: 14, overflow: "hidden" },
    thumbs: { flexDirection: "row", gap: 12, paddingVertical: 14 },
    thumb: { flex: 1 },
    thumbFrame: { aspectRatio: 1, borderRadius: 12, backgroundColor: "rgba(127,127,127,0.12)", overflow: "hidden" },
    thumbLabel: { color: text.secondaryLabel, fontSize: 11, textAlign: "center", marginTop: 6 },
    row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: text.tertiaryLabel, gap: 12 },
    rowLast: { borderBottomWidth: 0 },
    rowLabel: { color: text.label, fontSize: 15 },
    rowValue: { color: text.secondaryLabel, fontSize: 15, flexShrink: 1, textAlign: "right", fontVariant: ["tabular-nums"] },
    foot: { color: text.secondaryLabel, fontSize: 11, textAlign: "center", marginTop: 16 },
  });
