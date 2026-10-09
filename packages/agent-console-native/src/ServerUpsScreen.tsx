/**
 * The UPS page for a server, rendered natively from the Mac mini's UPS
 * dashboard API (`/api/ups`, served by ~/ups-monitor/server.js) — every value
 * the UPS exposes plus derived series and stats, polled live:
 *
 * - a charge ring + status + runtime hero,
 * - line & battery voltage, over the selected range (1h / 6h / 24h),
 * - charge over time, an outage timeline, and a stats grid,
 * - the event log.
 *
 * The first "server page"; later it becomes a plugin contribution to a generic
 * Server page.
 *
 * @internal
 */
import { GlassView } from "expo-glass-effect";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useColorScheme, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop, Text as RNSvgText } from "react-native-svg";
import type { RootStackParamList } from "./RootNavigator";
import { type TextColors, useScreenBackground, useThemedStyles } from "./theme";

/** The UPS dashboard runs on each server at :5196 (~/ups-monitor/server.js).
 * The server's address is passed in by route, never hardcoded, so the same
 * page serves any server. */
const UPS_PORT = 5196;
const POLL_MS = 4000;

const ACCENT = "#0a84ff";
const GREEN = "#32d74b";
const RED = "#ff453a";
const AMBER = "#ffd60a";
const PURPLE = "#bf5af2";
const GRID = "rgba(142,147,163,0.22)";
const TRACK = "rgba(142,147,163,0.2)";
const MUTED = "#8b94a3"; // plain string for SVG labels (theme colors are opaque)

type Point = readonly [number, number];
interface UpsNow {
  readonly status: string;
  readonly online: boolean;
  readonly onBattery: boolean;
  readonly lowBattery: boolean;
  readonly charge: number | null;
  readonly runtimeMin: number | null;
  readonly lineV: number | null;
  readonly batteryV: number | null;
  readonly model: string;
}
interface Stats {
  readonly lineMin: number | null;
  readonly lineMax: number | null;
  readonly lineAvg: number | null;
  readonly outageCount: number;
  readonly downtimeS: number;
  readonly pctOnAC: number;
  readonly brownouts: number;
  readonly samples: number;
}
interface Outage {
  readonly start: number;
  readonly end: number | null;
}
interface UpsData {
  readonly updated: number;
  readonly now: UpsNow;
  readonly series: { readonly line: ReadonlyArray<Point>; readonly battery: ReadonlyArray<Point>; readonly charge: ReadonlyArray<Point>; readonly runtime: ReadonlyArray<Point> };
  readonly outages: ReadonlyArray<Outage>;
  readonly stats: Stats;
  readonly events: ReadonlyArray<string>;
}

const RANGES = [
  { label: "1h", mins: 60 },
  { label: "6h", mins: 360 },
  { label: "24h", mins: 1440 },
] as const;

const useUps = (baseUrl: string, mins: number): { readonly data: UpsData | undefined; readonly error: boolean } => {
  const [data, setData] = React.useState<UpsData | undefined>(undefined);
  const [error, setError] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    const tick = (): void => {
      void fetch(`${baseUrl}/api/ups?mins=${mins}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d: UpsData) => {
          if (!alive) return;
          setData(d);
          setError(false);
        })
        .catch(() => {
          if (alive) setError(true);
        });
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [baseUrl, mins]);
  return { data, error };
};

const fmtDuration = (s: number): string => {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
};

/** Circular charge gauge. */
const Ring = (props: { readonly pct: number | null; readonly color: string; readonly label: string }): React.ReactElement => {
  const size = 132;
  const stroke = 11;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = props.pct ?? 0;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={TRACK} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={props.color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </Svg>
      <Text style={styles2.ringPct}>
        {props.pct ?? "—"}
        <Text style={styles2.ringUnit}>%</Text>
      </Text>
      <Text style={styles2.ringLabel}>{props.label}</Text>
    </View>
  );
};

/** Area+line chart with an optional reference line and brownout band. */
const Chart = (props: {
  readonly data: ReadonlyArray<Point>;
  readonly width: number;
  readonly color: string;
  readonly min?: number;
  readonly max?: number;
  readonly refValue?: number;
  readonly dangerBelow?: number;
  readonly unit: string;
  readonly mutedColor: string;
}): React.ReactElement => {
  const h = 150;
  const w = props.width;
  const pts = props.data.filter((p) => p[1] != null);
  if (pts.length < 2) {
    return (
      <View style={{ height: h, justifyContent: "center", alignItems: "center" }}>
        <Text style={{ color: props.mutedColor, fontSize: 13 }}>collecting…</Text>
      </View>
    );
  }
  const t0 = pts[0][0];
  const t1 = pts[pts.length - 1][0] || t0 + 1;
  let lo = Math.min(...pts.map((p) => p[1]));
  let hi = Math.max(...pts.map((p) => p[1]));
  if (props.min != null) lo = Math.min(lo, props.min);
  if (props.max != null) hi = Math.max(hi, props.max);
  if (props.refValue != null) {
    lo = Math.min(lo, props.refValue);
    hi = Math.max(hi, props.refValue);
  }
  const pad = (hi - lo) * 0.12 || 2;
  lo -= pad;
  hi += pad;
  const X = (t: number): number => ((t - t0) / (t1 - t0 || 1)) * (w - 8) + 4;
  const Y = (v: number): number => h - 18 - ((v - lo) / (hi - lo || 1)) * (h - 30);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ");
  const fill = `${line} L${X(pts[pts.length - 1][0]).toFixed(1)},${h - 18} L${X(pts[0][0]).toFixed(1)},${h - 18} Z`;
  const gid = `g${Math.round(props.color.charCodeAt(1) + w)}`;
  return (
    <Svg width={w} height={h}>
      <Defs>
        <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={props.color} stopOpacity={0.28} />
          <Stop offset="1" stopColor={props.color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      {props.dangerBelow != null && Y(props.dangerBelow) < h - 18 ? <Rect x={0} y={Y(props.dangerBelow)} width={w} height={h - 18 - Y(props.dangerBelow)} fill="rgba(255,69,58,0.08)" /> : null}
      {props.refValue != null ? (
        <>
          <Line x1={0} y1={Y(props.refValue)} x2={w} y2={Y(props.refValue)} stroke={GRID} strokeWidth={1} strokeDasharray="3 3" />
        </>
      ) : null}
      <Path d={fill} fill={`url(#${gid})`} />
      <Path d={line} stroke={props.color} strokeWidth={2} fill="none" strokeLinejoin="round" />
      <SvgText x={w - 4} y={10} fill={props.mutedColor} anchor="end">{`${Math.round(hi)}${props.unit}`}</SvgText>
      <SvgText x={w - 4} y={h - 22} fill={props.mutedColor} anchor="end">{`${Math.round(lo)}${props.unit}`}</SvgText>
    </Svg>
  );
};

const SvgText = (props: { readonly x: number; readonly y: number; readonly fill: string; readonly anchor: "start" | "end"; readonly children: string }): React.ReactElement => (
  <RNSvgText x={props.x} y={props.y} fill={props.fill} fontSize={10} textAnchor={props.anchor}>
    {props.children}
  </RNSvgText>
);

/** Horizontal AC/battery timeline across the window. */
const Timeline = (props: { readonly outages: ReadonlyArray<Outage>; readonly width: number; readonly mins: number; readonly now: number }): React.ReactElement => {
  const h = 14;
  const w = props.width;
  const t1 = props.now / 1000;
  const t0 = t1 - props.mins * 60;
  const X = (t: number): number => Math.max(0, Math.min(w, ((t - t0) / (t1 - t0 || 1)) * w));
  return (
    <Svg width={w} height={h}>
      <Rect x={0} y={0} width={w} height={h} rx={4} fill="rgba(50,215,75,0.35)" />
      {props.outages.map((o, i) => {
        const x = X(o.start);
        const xe = X(o.end ?? t1);
        return <Rect key={i} x={x} y={0} width={Math.max(2, xe - x)} height={h} fill={RED} />;
      })}
    </Svg>
  );
};

type Props = NativeStackScreenProps<RootStackParamList, "ServerUps">;

export const ServerUpsScreen = (props: Props): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const background = useScreenBackground("grouped");
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { width } = useWindowDimensions();
  const [mins, setMins] = React.useState<number>(60);
  const baseUrl = `http://${props.route.params.serverAddress}:${UPS_PORT}`;
  const { data, error } = useUps(baseUrl, mins);

  const now = data?.now;
  const ringColor = now?.onBattery ? RED : now?.lowBattery || (now?.charge ?? 100) < 30 ? AMBER : GREEN;
  const pill = now?.onBattery ? { label: "ON BATTERY", s: styles.pillBad } : now?.lowBattery ? { label: "LOW BATTERY", s: styles.pillWarn } : now?.online ? { label: "ON AC", s: styles.pillOk } : { label: now?.status ?? "—", s: styles.pillWarn };
  const cardW = width - 32;
  const chartW = cardW - 28;

  return (
    <ScrollView style={{ backgroundColor: background }} contentInsetAdjustmentBehavior="never" contentContainerStyle={{ padding: 16, paddingTop: headerHeight + 8, paddingBottom: insets.bottom + 48 }}>
      <View style={styles.top}>
        <View>
          <Text style={styles.h1}>UPS</Text>
          <Text style={styles.sub}>{now?.model ?? "CyberPower"}</Text>
        </View>
        <View style={[styles.pill, pill.s]}>
          <Text style={[styles.pillText, pill.s]}>{pill.label}</Text>
        </View>
      </View>

      {data === undefined ? (
        <View style={styles.loading}>{error ? <Text style={styles.offline}>Can’t reach the UPS server.</Text> : <ActivityIndicator />}</View>
      ) : (
        <>
          {/* Hero: charge ring + runtime */}
          <GlassView style={styles.hero} glassEffectStyle="regular" colorScheme={scheme}>
            <Ring pct={now?.charge ?? null} color={ringColor} label="charge" />
            <View style={styles.heroRight}>
              <Text style={styles.k}>Runtime left</Text>
              <Text style={styles.big}>
                {now?.runtimeMin ?? "—"}
                <Text style={styles.unit}> min</Text>
              </Text>
              <View style={styles.heroStat}>
                <Text style={styles.k}>Line</Text>
                <Text style={styles.heroStatV}>{now?.lineV != null ? `${Math.round(now.lineV)} V` : "—"}</Text>
              </View>
              <View style={styles.heroStat}>
                <Text style={styles.k}>Battery</Text>
                <Text style={styles.heroStatV}>{now?.batteryV != null ? `${now.batteryV.toFixed(1)} V` : "—"}</Text>
              </View>
            </View>
          </GlassView>

          {/* Range selector */}
          <View style={styles.ranges}>
            {RANGES.map((r) => (
              <Pressable key={r.mins} onPress={() => setMins(r.mins)} style={[styles.range, mins === r.mins && styles.rangeOn]}>
                <Text style={[styles.rangeText, mins === r.mins && styles.rangeTextOn]}>{r.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* Line voltage */}
          <GlassView style={styles.chartCard} glassEffectStyle="regular" colorScheme={scheme}>
            <View style={styles.chartHead}>
              <Text style={styles.k}>Line voltage</Text>
              <Text style={styles.chartMeta}>{data.stats.lineMin != null ? `${Math.round(data.stats.lineMin)}–${Math.round(data.stats.lineMax ?? 0)}V · avg ${data.stats.lineAvg}V` : ""}</Text>
            </View>
            <Chart data={data.series.line} width={chartW} color={ACCENT} refValue={120} dangerBelow={104} unit="" mutedColor={MUTED} />
          </GlassView>

          {/* Charge over time */}
          <GlassView style={styles.chartCard} glassEffectStyle="regular" colorScheme={scheme}>
            <Text style={styles.k}>Charge</Text>
            <Chart data={data.series.charge} width={chartW} color={GREEN} min={0} max={100} unit="%" mutedColor={MUTED} />
          </GlassView>

          {/* Battery voltage */}
          <GlassView style={styles.chartCard} glassEffectStyle="regular" colorScheme={scheme}>
            <Text style={styles.k}>Battery voltage</Text>
            <Chart data={data.series.battery} width={chartW} color={PURPLE} unit="V" mutedColor={MUTED} />
          </GlassView>

          {/* Power timeline */}
          <GlassView style={styles.chartCard} glassEffectStyle="regular" colorScheme={scheme}>
            <View style={styles.chartHead}>
              <Text style={styles.k}>Power</Text>
              <Text style={styles.chartMeta}>{data.stats.pctOnAC}% on AC{data.stats.outageCount > 0 ? ` · ${data.stats.outageCount} outage${data.stats.outageCount > 1 ? "s" : ""}` : ""}</Text>
            </View>
            {data.updated ? <Timeline outages={data.outages} width={chartW} mins={mins} now={data.updated} /> : null}
          </GlassView>

          {/* Stats grid */}
          <View style={styles.statGrid}>
            <Stat styles={styles} label="Outages" value={String(data.stats.outageCount)} />
            <Stat styles={styles} label="Downtime" value={data.stats.downtimeS > 0 ? fmtDuration(data.stats.downtimeS) : "0"} />
            <Stat styles={styles} label="Brownouts" value={String(data.stats.brownouts)} />
            <Stat styles={styles} label="On AC" value={`${data.stats.pctOnAC}%`} />
            <Stat styles={styles} label="Min line" value={data.stats.lineMin != null ? `${Math.round(data.stats.lineMin)}V` : "—"} />
            <Stat styles={styles} label="Max line" value={data.stats.lineMax != null ? `${Math.round(data.stats.lineMax)}V` : "—"} />
          </View>

          {/* Events */}
          <Text style={styles.sectionLabel}>Events</Text>
          <GlassView style={styles.events} glassEffectStyle="regular" colorScheme={scheme}>
            {data.events.length === 0 ? (
              <Text style={styles.eventNone}>No events — power steady.</Text>
            ) : (
              data.events.map((e, i) => {
                const sep = e.indexOf(" | ");
                const time = sep > 0 ? e.slice(5, 19) : "";
                const msg = sep > 0 ? e.slice(sep + 3) : e;
                return (
                  <View key={i} style={[styles.eventRow, i === data.events.length - 1 && styles.eventLast]}>
                    <Text style={styles.eventTime}>{time}</Text>
                    <Text style={styles.eventMsg}>{msg}</Text>
                  </View>
                );
              })
            )}
          </GlassView>

          <Text style={styles.foot}>updated {new Date(data.updated).toLocaleTimeString()} · {data.stats.samples} samples</Text>
        </>
      )}
    </ScrollView>
  );
};

const Stat = (props: { readonly styles: ReturnType<typeof makeStyles>; readonly label: string; readonly value: string }): React.ReactElement => (
  <View style={props.styles.statCell}>
    <Text style={props.styles.statV}>{props.value}</Text>
    <Text style={props.styles.statK}>{props.label}</Text>
  </View>
);

const styles2 = StyleSheet.create({
  ringPct: { color: "#f5f7fa", fontSize: 34, fontWeight: "800", fontVariant: ["tabular-nums"] },
  ringUnit: { fontSize: 16, fontWeight: "700", color: "rgba(255,255,255,0.6)" },
  ringLabel: { color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 2 },
});

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
    h1: { color: text.label, fontSize: 22, fontWeight: "700" },
    sub: { color: text.secondaryLabel, fontSize: 12, marginTop: 2 },
    pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
    pillText: { fontSize: 13, fontWeight: "700" },
    pillOk: { backgroundColor: "rgba(50,215,75,0.16)", color: GREEN },
    pillBad: { backgroundColor: "rgba(255,69,58,0.16)", color: RED },
    pillWarn: { backgroundColor: "rgba(255,214,10,0.16)", color: AMBER },
    loading: { paddingVertical: 60, alignItems: "center" },
    offline: { color: text.secondaryLabel, fontSize: 14 },
    hero: { flexDirection: "row", alignItems: "center", gap: 18, borderRadius: 20, padding: 18, overflow: "hidden", marginBottom: 14 },
    heroRight: { flex: 1 },
    heroStat: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 8 },
    heroStatV: { color: text.label, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
    big: { color: text.label, fontSize: 30, fontWeight: "800", fontVariant: ["tabular-nums"], marginTop: 2 },
    unit: { color: text.secondaryLabel, fontSize: 15, fontWeight: "600" },
    k: { color: text.secondaryLabel, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3 },
    ranges: { flexDirection: "row", gap: 8, marginBottom: 14 },
    range: { flex: 1, borderRadius: 10, paddingVertical: 9, alignItems: "center", backgroundColor: "rgba(127,127,127,0.12)" },
    rangeOn: { backgroundColor: "rgba(10,132,255,0.18)" },
    rangeText: { color: text.secondaryLabel, fontSize: 14, fontWeight: "600" },
    rangeTextOn: { color: ACCENT },
    chartCard: { borderRadius: 18, padding: 14, overflow: "hidden", marginBottom: 12 },
    chartHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 2 },
    chartMeta: { color: text.secondaryLabel, fontSize: 11, fontVariant: ["tabular-nums"] },
    statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4, marginBottom: 16 },
    statCell: { width: "31%", flexGrow: 1, backgroundColor: "rgba(127,127,127,0.1)", borderRadius: 14, paddingVertical: 12, alignItems: "center" },
    statV: { color: text.label, fontSize: 19, fontWeight: "800", fontVariant: ["tabular-nums"] },
    statK: { color: text.secondaryLabel, fontSize: 11, fontWeight: "600", marginTop: 2, textTransform: "uppercase", letterSpacing: 0.3 },
    sectionLabel: { color: text.secondaryLabel, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3, marginLeft: 2, marginBottom: 8 },
    events: { borderRadius: 16, paddingHorizontal: 14, overflow: "hidden" },
    eventRow: { flexDirection: "row", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: text.tertiaryLabel, gap: 8 },
    eventLast: { borderBottomWidth: 0 },
    eventTime: { color: text.secondaryLabel, fontSize: 11, fontVariant: ["tabular-nums"] },
    eventMsg: { color: text.label, fontSize: 13, flex: 1 },
    eventNone: { color: text.secondaryLabel, fontSize: 13, paddingVertical: 12 },
    foot: { color: text.secondaryLabel, fontSize: 11, textAlign: "center", marginTop: 16 },
  });
