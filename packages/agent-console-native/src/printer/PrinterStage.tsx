/**
 * The printer page's stage: the LCD with the layer it shows now, the print's
 * progress, and pause, resume, and stop.
 *
 * The LCD is drawn at the printer's real size in millimetres. Layer images
 * cover the whole LCD with square pixels (16K pixels are not square; the
 * relay and the phone's decoder correct for it), so every layer shows at one
 * scale. The Measurements switch adds a 10 mm grid, a ruler, and the layer
 * number; it is off by default. The lit area glows while the printer
 * exposes the layer and dims while it lifts and drops. The glow and the
 * progress bar take the theme's colours (printer/ui.tsx `usePalette`).
 *
 * The progress bar's grabber scrubs through the layers: the LCD shows the
 * layer under it, and Live goes back to the layer the printer is on.
 *
 * @internal
 */
import { LinearGradient } from "expo-linear-gradient";
import * as React from "react";
import { Alert, Animated, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Svg, { Line, Text as SvgText } from "react-native-svg";
import { towardWhite, useTextColors, withAlpha } from "../theme";
import { fmtDuration } from "./printerFormat";
import { CMD_PAUSE, CMD_RESUME, CMD_STOP, controlAckLabel, PHASE_PAUSED, PHASE_PAUSING, PHASE_STOPPING, type ControlCmd } from "./sdcp";
import { Button, Dot, LCD, usePalette } from "./ui";

/**
 * Shows the newest image only once it has loaded, so the LCD never flashes
 * empty between layers (one a few seconds apart on a 16K printer).
 *
 * One fetch at a time, always for the newest uri: the relay draws one layer
 * image at a time, and a slow printer would otherwise build a queue of old
 * layers there.
 */
export const useLoadedUri = (uri: string | undefined): string | undefined => {
  const [shown, setShown] = React.useState<string | undefined>(undefined);
  const wanted = React.useRef<string | undefined>(undefined);
  const loading = React.useRef(false);
  const alive = React.useRef(true);
  React.useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const pump = React.useCallback((): void => {
    const next = wanted.current;
    if (loading.current || next === undefined) return;
    loading.current = true;
    void Image.prefetch(next)
      .then((ok) => {
        // Still newer than the image on screen, even if the printer has moved on.
        if (alive.current && ok && wanted.current !== undefined) setShown(next);
      })
      .catch(() => undefined)
      .finally(() => {
        loading.current = false;
        // A failed fetch waits for the next layer; a newer layer starts now.
        if (alive.current && wanted.current !== next) pump();
      });
  }, []);
  React.useEffect(() => {
    if (uri === undefined) return;
    if (uri.startsWith("data:")) {
      wanted.current = undefined;
      setShown(uri);
      return;
    }
    wanted.current = uri;
    pump();
  }, [uri, pump]);
  return shown;
};

const Hud = (props: { readonly children: React.ReactNode; readonly style: object }): React.ReactElement => <View style={[styles.hud, props.style]}>{props.children}</View>;

/** The printer's LCD: dark glass, the lit layer, the phase, and (with `measure`) a 10 mm grid, a ruler, and the layer number. */
export const Lcd = (props: {
  readonly width: number;
  readonly lcdMm: { readonly width: number; readonly height: number };
  readonly uri: string | undefined;
  readonly exposing: boolean;
  /** Fully lit without the exposing mark: a layer the owner scrubbed to. */
  readonly lit?: boolean;
  readonly active: boolean;
  readonly layer: number | undefined;
  readonly phase: string | undefined;
  readonly measure: boolean;
  readonly note: string | undefined;
}): React.ReactElement => {
  const palette = usePalette();
  const height = props.width * (props.lcdMm.height / props.lcdMm.width);
  const bright = props.exposing || props.lit === true;
  const glow = React.useRef(new Animated.Value(bright ? 1 : 0)).current;
  React.useEffect(() => {
    Animated.timing(glow, { toValue: bright ? 1 : 0, duration: 320, useNativeDriver: true }).start();
  }, [glow, bright]);
  const perMm = props.width / props.lcdMm.width;
  const columns = Math.floor(props.lcdMm.width / 10);
  const rows = Math.floor(props.lcdMm.height / 10);
  return (
    <View style={[styles.lcd, { width: props.width, height }]}>
      {props.measure ? (
      <Svg width={props.width} height={height} style={StyleSheet.absoluteFill}>
        {Array.from({ length: columns }, (_, i) => (
          <Line key={`x${i}`} x1={(i + 1) * 10 * perMm} y1={0} x2={(i + 1) * 10 * perMm} y2={height} stroke="rgba(255,255,255,0.035)" strokeWidth={1} />
        ))}
        {Array.from({ length: rows }, (_, i) => (
          <Line key={`y${i}`} x1={0} y1={(i + 1) * 10 * perMm} x2={props.width} y2={(i + 1) * 10 * perMm} stroke="rgba(255,255,255,0.035)" strokeWidth={1} />
        ))}
        {Array.from({ length: columns }, (_, i) => {
          const mm = (i + 1) * 10;
          const major = mm % 50 === 0;
          return (
            <React.Fragment key={`t${i}`}>
              <Line x1={mm * perMm} y1={height - (major ? 8 : 4)} x2={mm * perMm} y2={height} stroke={major ? "rgba(244,245,249,0.38)" : "rgba(244,245,249,0.2)"} strokeWidth={1} />
              {major ? (
                <SvgText x={mm * perMm + 3} y={height - 10} fill="rgba(244,245,249,0.38)" fontSize={8}>
                  {String(mm)}
                </SvgText>
              ) : null}
            </React.Fragment>
          );
        })}
      </Svg>
      ) : null}
      {props.uri !== undefined ? (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [props.active ? 0.4 : 0.55, 1] }),
              shadowColor: palette.accent,
              shadowOpacity: 0.95,
              shadowRadius: 9,
              shadowOffset: { width: 0, height: 0 },
            },
          ]}
        >
          <Image source={{ uri: props.uri }} style={StyleSheet.absoluteFill} resizeMode="stretch" tintColor={towardWhite(palette.accent, 0.88)} />
        </Animated.View>
      ) : (
        <View style={styles.lcdEmpty}>
          <Text style={styles.lcdNote}>{props.note ?? "No print running"}</Text>
        </View>
      )}
      {props.measure && props.layer !== undefined ? (
        <Hud style={styles.tl}>
          <Text style={styles.hudText}>Layer {props.layer.toLocaleString()}</Text>
        </Hud>
      ) : null}
      {props.active && props.phase !== undefined ? (
        <Hud style={styles.tr}>
          {props.exposing ? <Dot tone="uv" size={6} /> : null}
          <Text style={[styles.hudText, props.exposing ? { color: towardWhite(palette.accent, 0.7) } : null]}>{props.phase}</Text>
        </Hud>
      ) : null}
    </View>
  );
};

/**
 * How long the grabber rests before the LCD asks for the full layer under it.
 * Each full layer image is a read from the printer's file server, so a drag
 * asks for the layers it stops on, not every layer it passes. The layer pack
 * on the device shows every layer the drag passes.
 */
const SCRUB_SETTLE_MS = 200;
const GRABBER = 22;

/**
 * The progress bar with a grabber. The fill is the print's progress; the
 * grabber is the layer the LCD shows: the printer's own until the owner drags
 * it or taps the bar. `onScrub` gets the chosen layer (1 to `total`).
 */
const Scrubber = (props: {
  readonly width: number;
  readonly total: number;
  readonly live: number;
  readonly viewed: number | undefined;
  readonly percent: number;
  readonly fill: readonly [string, string];
  readonly onScrub: (layer: number) => void;
  readonly onDrag: (layer: number | undefined) => void;
}): React.ReactElement => {
  const palette = usePalette();
  const [dragging, setDragging] = React.useState<number | undefined>(undefined);
  const settle = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(settle.current), []);
  const layerAt = (x: number): number => Math.min(props.total, Math.max(1, Math.round((x / props.width) * props.total)));
  const move = (x: number): void => {
    const layer = layerAt(x);
    setDragging(layer);
    props.onDrag(layer);
    clearTimeout(settle.current);
    settle.current = setTimeout(() => props.onScrub(layer), SCRUB_SETTLE_MS);
  };
  const end = (x: number): void => {
    clearTimeout(settle.current);
    setDragging(undefined);
    props.onDrag(undefined);
    props.onScrub(layerAt(x));
  };
  // Sideways only, so the page still scrolls up and down over the bar.
  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-6, 6])
    .failOffsetY([-12, 12])
    .onUpdate((event) => move(event.x))
    .onEnd((event) => end(event.x))
    .onFinalize((_event, success) => {
      if (!success) {
        setDragging(undefined);
        props.onDrag(undefined);
      }
    });
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((event) => end(event.x));
  const shown = dragging ?? props.viewed ?? props.live;
  const x = Math.min(props.width, Math.max(0, (shown / props.total) * props.width));
  const scrubbed = dragging !== undefined || props.viewed !== undefined;
  return (
    <GestureDetector gesture={Gesture.Race(pan, tap)}>
      <View style={[styles.scrub, { width: props.width }]} accessibilityRole="adjustable" accessibilityLabel="Layer" accessibilityValue={{ min: 1, max: props.total, now: shown }}>
        <View style={styles.track}>
          <LinearGradient colors={props.fill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.fill, { width: `${Math.min(100, props.percent)}%` }]} />
        </View>
        <View pointerEvents="none" style={[styles.grabber, { left: x - GRABBER / 2, borderColor: scrubbed ? palette.accent : "rgba(0,0,0,0.12)" }]} />
      </View>
    </GestureDetector>
  );
};

/** Percent, a bar, and elapsed, remaining, and finish time, and the Z height. `columns` is 2 on a phone, 4 when there is room. */
export const Progress = (props: {
  readonly width: number;
  readonly totalLayers: number;
  readonly liveLayer: number;
  /** The layer the LCD shows when the owner scrubbed to one; undefined while it follows the printer. */
  readonly viewedLayer: number | undefined;
  readonly onScrub: (layer: number | undefined) => void;
  /** The layer under the finger while the owner drags, and undefined when the drag ends. */
  readonly onDrag?: (layer: number | undefined) => void;
  readonly percent: number;
  readonly elapsedMs: number | undefined;
  readonly remainingMs: number | undefined;
  readonly totalMs: number | undefined;
  readonly active: boolean;
  readonly paused: boolean;
  readonly complete: boolean;
  readonly finishAt: Date | undefined;
  readonly zMm: number | undefined;
  readonly heightMm: number | undefined;
  readonly columns: 2 | 4;
}): React.ReactElement => {
  const text = useTextColors();
  const palette = usePalette();
  const cell = props.columns === 2 ? styles.statHalf : styles.statQuarter;
  const whole = Math.floor(props.percent);
  const fraction = Math.floor((props.percent % 1) * 10);
  const fill: readonly [string, string] = props.complete ? [palette.ok, palette.ok] : props.paused ? [palette.warn, palette.warn] : [palette.second, palette.accent];
  // The layer under the finger while dragging, before the LCD has it.
  const [dragLayer, setDragLayer] = React.useState<number | undefined>(undefined);
  const looking = dragLayer ?? props.viewedLayer;
  return (
    <View style={styles.progress}>
      <View style={styles.progressTop}>
        <Text style={[styles.pct, { color: text.label }]}>
          {whole}
          <Text style={[styles.pctSmall, { color: text.secondaryLabel }]}>.{fraction}%</Text>
        </Text>
        {looking !== undefined ? (
          <View style={styles.scrubInfo}>
            <Text style={[styles.scrubLayer, { color: text.secondaryLabel }]} numberOfLines={1}>
              Layer {looking.toLocaleString()} of {props.totalLayers.toLocaleString()}
            </Text>
            <Pressable hitSlop={8} onPress={() => props.onScrub(undefined)} accessibilityLabel="Show the live layer" style={({ pressed }) => [styles.live, { backgroundColor: withAlpha(palette.accent, pressed ? 0.28 : 0.16) }]}>
              <Dot tone="uv" size={6} />
              <Text style={[styles.liveText, { color: palette.accentInk }]}>Live</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      {props.totalLayers > 0 ? (
        <Scrubber
          width={props.width}
          total={props.totalLayers}
          live={props.liveLayer}
          viewed={props.viewedLayer}
          percent={props.percent}
          fill={fill}
          onScrub={props.onScrub}
          onDrag={(layer) => {
            setDragLayer(layer);
            props.onDrag?.(layer);
          }}
        />
      ) : (
        <View style={styles.track}>
          <LinearGradient colors={fill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.fill, { width: `${Math.min(100, props.percent)}%` }]} />
        </View>
      )}
      <View style={styles.stats}>
        <Stat style={cell} label="Elapsed" value={fmtDuration(props.elapsedMs)} />
        <Stat style={cell} label="Remaining" value={props.active ? fmtDuration(props.remainingMs) : "—"} />
        <Stat style={cell} label={props.active ? "Finishes" : "Total"} value={props.active ? (props.finishAt === undefined ? "—" : props.finishAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })) : fmtDuration(props.totalMs)} />
        <Stat style={cell} label="Height" value={props.zMm === undefined ? "—" : `${props.zMm.toFixed(2)} mm`} extra={props.heightMm === undefined ? undefined : `of ${props.heightMm.toFixed(2)}`} />
      </View>
    </View>
  );
};

const Stat = (props: { readonly label: string; readonly value: string; readonly extra?: string; readonly style: object }): React.ReactElement => {
  const text = useTextColors();
  return (
    <View style={props.style}>
      <Text style={[styles.statLabel, { color: text.tertiaryLabel }]}>{props.label.toUpperCase()}</Text>
      <Text style={[styles.statValue, { color: text.label }]} numberOfLines={1}>
        {props.value}
        {props.extra !== undefined ? <Text style={[styles.statExtra, { color: text.tertiaryLabel }]}> {props.extra}</Text> : null}
      </Text>
    </View>
  );
};

const CONFIRM: Record<ControlCmd, { readonly title: string; readonly message: string; readonly action: string; readonly destructive: boolean }> = {
  [CMD_PAUSE]: { title: "Pause the print?", message: "The printer finishes the current layer and lifts the plate. It takes about a minute to settle.", action: "Pause", destructive: false },
  [CMD_RESUME]: { title: "Resume the print?", message: "The printer continues from the layer where it paused.", action: "Resume", destructive: false },
  [CMD_STOP]: { title: "Stop the print?", message: "The print ends and cannot be resumed.", action: "Stop Print", destructive: true },
};

/**
 * Pause or resume, and stop, for a running print. Each asks first. While the
 * printer is pausing or stopping the buttons wait, because a second command
 * then gets a "busy" ack.
 */
export const Controls = (props: { readonly phase: number | undefined; readonly send: (cmd: ControlCmd) => Promise<number> }): React.ReactElement => {
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
  const toggle = paused ? CMD_RESUME : CMD_PAUSE;
  return (
    <View style={styles.controls}>
      <Button
        style={styles.controlButton}
        kind={paused ? "primary" : "default"}
        icon={paused ? "play.fill" : "pause.fill"}
        label={props.phase === PHASE_PAUSING ? "Pausing…" : paused ? "Resume" : "Pause"}
        busy={busy === toggle}
        disabled={busy !== undefined || settling}
        onPress={() => run(toggle)}
      />
      <Button style={styles.controlButton} kind="destructive" icon="stop.fill" label={props.phase === PHASE_STOPPING ? "Stopping…" : "Stop"} busy={busy === CMD_STOP} disabled={busy !== undefined || settling} onPress={() => run(CMD_STOP)} />
    </View>
  );
};

const styles = StyleSheet.create({
  lcd: { backgroundColor: LCD, borderRadius: 16, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.1)" },
  lcdEmpty: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", padding: 20 },
  lcdNote: { color: "rgba(244,245,249,0.5)", fontSize: 13, textAlign: "center" },
  hud: { position: "absolute", flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, height: 22, borderRadius: 7, backgroundColor: "rgba(10,11,18,0.62)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.12)" },
  hudText: { color: "rgba(244,245,249,0.88)", fontSize: 11, fontWeight: "600", fontVariant: ["tabular-nums"] },
  tl: { top: 8, left: 8 },
  tr: { top: 8, right: 8 },
  progress: { marginTop: 16 },
  progressTop: { flexDirection: "row", alignItems: "flex-end", marginBottom: 10 },
  pct: { fontSize: 46, fontWeight: "700", letterSpacing: -1.5, fontVariant: ["tabular-nums"] },
  pctSmall: { fontSize: 20, fontWeight: "600", letterSpacing: -0.3 },
  track: { height: 8, borderRadius: 4, backgroundColor: "rgba(127,127,127,0.2)", overflow: "hidden" },
  scrub: { height: 28, justifyContent: "center" },
  grabber: {
    position: "absolute",
    top: (28 - GRABBER) / 2,
    width: GRABBER,
    height: GRABBER,
    borderRadius: GRABBER / 2,
    borderWidth: 2,
    backgroundColor: "#ffffff",
    shadowColor: "#000000",
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  scrubInfo: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 10, marginBottom: 8 },
  scrubLayer: { fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] },
  live: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  liveText: { fontSize: 13, fontWeight: "700" },
  fill: { height: 8, borderRadius: 4 },
  stats: { flexDirection: "row", flexWrap: "wrap", marginTop: 14, columnGap: 8, rowGap: 12 },
  statHalf: { width: "48%" },
  statQuarter: { flex: 1 },
  statLabel: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.6 },
  statValue: { fontSize: 17, fontWeight: "600", marginTop: 2, fontVariant: ["tabular-nums"] },
  statExtra: { fontSize: 12, fontWeight: "600" },
  controls: { flexDirection: "row", gap: 10, marginTop: 16 },
  controlButton: { flex: 1 },
});
