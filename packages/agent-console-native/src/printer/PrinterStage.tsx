/**
 * The printer page's stage: the LCD with the layer it shows now, the print's
 * progress, and pause, resume, and stop.
 *
 * The LCD is drawn at the printer's real size in millimetres. Layer images
 * cover the whole LCD with square pixels (16K pixels are not square; the
 * relay and the phone's decoder correct for it), so every layer shows at one
 * scale. The Measurements switch adds a 10 mm grid, a ruler, and the layer
 * number; it is off by default. The lit area glows while the printer
 * exposes the layer and dims while it lifts and drops.
 *
 * @internal
 */
import { LinearGradient } from "expo-linear-gradient";
import * as React from "react";
import { Alert, Animated, Image, StyleSheet, Text, View } from "react-native";
import Svg, { Line, Text as SvgText } from "react-native-svg";
import { useTextColors } from "../theme";
import { fmtDuration } from "./printerFormat";
import { CMD_PAUSE, CMD_RESUME, CMD_STOP, controlAckLabel, PHASE_PAUSED, PHASE_PAUSING, PHASE_STOPPING, type ControlCmd } from "./sdcp";
import { AMBER, Button, Dot, GREEN, LCD, UV } from "./ui";

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
  readonly active: boolean;
  readonly layer: number | undefined;
  readonly phase: string | undefined;
  readonly measure: boolean;
  readonly note: string | undefined;
}): React.ReactElement => {
  const height = props.width * (props.lcdMm.height / props.lcdMm.width);
  const glow = React.useRef(new Animated.Value(props.exposing ? 1 : 0)).current;
  React.useEffect(() => {
    Animated.timing(glow, { toValue: props.exposing ? 1 : 0, duration: 320, useNativeDriver: true }).start();
  }, [glow, props.exposing]);
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
              shadowColor: UV,
              shadowOpacity: 0.95,
              shadowRadius: 9,
              shadowOffset: { width: 0, height: 0 },
            },
          ]}
        >
          <Image source={{ uri: props.uri }} style={StyleSheet.absoluteFill} resizeMode="stretch" tintColor="#f1ecff" />
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
          <Text style={[styles.hudText, props.exposing ? styles.hudLit : null]}>{props.phase}</Text>
        </Hud>
      ) : null}
    </View>
  );
};

/** Percent, a bar, and elapsed, remaining, and finish time, and the Z height. `columns` is 2 on a phone, 4 when there is room. */
export const Progress = (props: {
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
  const cell = props.columns === 2 ? styles.statHalf : styles.statQuarter;
  const whole = Math.floor(props.percent);
  const fraction = Math.floor((props.percent % 1) * 10);
  const fill = props.complete ? [GREEN, GREEN] : props.paused ? [AMBER, AMBER] : ["#5b7bff", UV];
  return (
    <View style={styles.progress}>
      <View style={styles.progressTop}>
        <Text style={[styles.pct, { color: text.label }]}>
          {whole}
          <Text style={[styles.pctSmall, { color: text.secondaryLabel }]}>.{fraction}%</Text>
        </Text>
      </View>
      <View style={styles.track}>
        <LinearGradient colors={fill as [string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.fill, { width: `${Math.min(100, props.percent)}%` }]} />
      </View>
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
  hudLit: { color: "#dcd2ff" },
  tl: { top: 8, left: 8 },
  tr: { top: 8, right: 8 },
  progress: { marginTop: 16 },
  progressTop: { flexDirection: "row", alignItems: "flex-end", marginBottom: 10 },
  pct: { fontSize: 46, fontWeight: "700", letterSpacing: -1.5, fontVariant: ["tabular-nums"] },
  pctSmall: { fontSize: 20, fontWeight: "600", letterSpacing: -0.3 },
  track: { height: 8, borderRadius: 4, backgroundColor: "rgba(127,127,127,0.2)", overflow: "hidden" },
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
