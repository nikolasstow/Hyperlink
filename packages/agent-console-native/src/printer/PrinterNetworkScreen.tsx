/**
 * The printer's network health, charted from the relay's `/api/network`
 * (RelayNetwork.ts on the home server). The relay sits beside the printer, so
 * it watches the printer's link: a ping every 20 s plus the connection and the
 * status age it already holds.
 *
 * The page shows the live state, ping latency and status-staleness over a
 * range, a connection timeline, the stats, and the events — with a loud flag
 * when the link looks like the pattern before a freeze (latency spikes, lost
 * pings, and a stale status together).
 *
 * It is a printer sub-page, like Files / Health / Settings, and polls the relay
 * on its own, built on the UPS page's chart patterns (ServerUpsScreen.tsx).
 *
 * @internal
 */
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, useColorScheme, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, Line, LinearGradient, Path, Rect, Stop, Text as RNSvgText } from "react-native-svg";
import type { RootStackParamList } from "../RootNavigator";
import { type TextColors, useScreenBackground, useThemedStyles } from "../theme";
import { fetchNetworkHealth, type NetworkHealth, type Point } from "./networkApi";
import { relayBaseOf } from "./sdcp";

const POLL_MS = 5000;

const ACCENT = "#0a84ff";
const GREEN = "#32d74b";
const RED = "#ff453a";
const AMBER = "#ffd60a";
const GRID = "rgba(142,147,163,0.22)";
const MUTED = "#8b94a3"; // plain string for SVG labels (theme colors are opaque)

interface Range {
  readonly label: string;
  readonly mins: number;
}

const FIXED: ReadonlyArray<Range> = [
  { label: "1h", mins: 60 },
  { label: "6h", mins: 360 },
  { label: "24h", mins: 1440 },
  { label: "2d", mins: 2880 },
  { label: "4d", mins: 5760 },
];

/** The ranges worth showing for how much data exists, plus all-time. Before data, the usual three. */
const rangesFor = (spanMins: number | undefined): ReadonlyArray<Range> => {
  if (spanMins === undefined) return FIXED.slice(0, 3);
  const out: Array<Range> = [];
  for (const range of FIXED) {
    out.push(range);
    if (range.mins >= spanMins) break;
  }
  out.push({ label: "All", mins: Math.max(60, Math.ceil(spanMins) + 1) });
  return out;
};

const useNetwork = (relayBase: string, mins: number): { readonly data: NetworkHealth | undefined; readonly error: boolean } => {
  const [data, setData] = React.useState<NetworkHealth | undefined>(undefined);
  const [error, setError] = React.useState(false);
  React.useEffect(() => {
    if (relayBase === "") return;
    let alive = true;
    const tick = (): void => {
      fetchNetworkHealth(relayBase, mins)
        .then((next) => {
          if (!alive) return;
          setData(next);
          setError(false);
        })
        .catch(() => {
          if (alive) setError(true);
        });
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    // Coming back to the foreground: refresh at once so the page is current.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") tick();
    });
    return () => {
      alive = false;
      clearInterval(id);
      subscription.remove();
    };
  }, [relayBase, mins]);
  return { data, error };
};

const fmtAge = (ms: number | null): string => {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
};

/** Area+line chart with an optional danger band. Shared shape with the UPS page. */
const Chart = (props: {
  readonly data: ReadonlyArray<Point>;
  readonly width: number;
  readonly color: string;
  readonly unit: string;
  readonly min?: number;
  readonly dangerAbove?: number;
}): React.ReactElement => {
  const h = 150;
  const w = props.width;
  const pts = props.data;
  if (pts.length < 2) {
    return (
      <View style={{ height: h, justifyContent: "center", alignItems: "center" }}>
        <Text style={{ color: MUTED, fontSize: 13 }}>collecting…</Text>
      </View>
    );
  }
  const t0 = pts[0][0];
  const t1 = pts[pts.length - 1][0] || t0 + 1;
  let lo = Math.min(...pts.map((p) => p[1]));
  let hi = Math.max(...pts.map((p) => p[1]));
  if (props.min != null) lo = Math.min(lo, props.min);
  if (props.dangerAbove != null) hi = Math.max(hi, props.dangerAbove);
  const pad = (hi - lo) * 0.12 || 1;
  lo -= pad;
  hi += pad;
  const X = (t: number): number => ((t - t0) / (t1 - t0 || 1)) * (w - 8) + 4;
  const Y = (v: number): number => h - 18 - ((v - lo) / (hi - lo || 1)) * (h - 30);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ");
  const fill = `${line} L${X(pts[pts.length - 1][0]).toFixed(1)},${h - 18} L${X(pts[0][0]).toFixed(1)},${h - 18} Z`;
  const gid = `ng${Math.round(props.color.charCodeAt(1) + w)}`;
  return (
    <Svg width={w} height={h}>
      <Defs>
        <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={props.color} stopOpacity={0.28} />
          <Stop offset="1" stopColor={props.color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      {props.dangerAbove != null && Y(props.dangerAbove) > 0 ? <Rect x={0} y={0} width={w} height={Y(props.dangerAbove)} fill="rgba(255,69,58,0.08)" /> : null}
      {props.dangerAbove != null ? <Line x1={0} y1={Y(props.dangerAbove)} x2={w} y2={Y(props.dangerAbove)} stroke={GRID} strokeWidth={1} strokeDasharray="3 3" /> : null}
      <Path d={fill} fill={`url(#${gid})`} />
      <Path d={line} stroke={props.color} strokeWidth={2} fill="none" strokeLinejoin="round" />
      <SvgText x={w - 4} y={10} fill={MUTED} anchor="end">{`${Math.round(hi)}${props.unit}`}</SvgText>
      <SvgText x={w - 4} y={h - 22} fill={MUTED} anchor="end">{`${Math.round(Math.max(0, lo))}${props.unit}`}</SvgText>
    </Svg>
  );
};

const SvgText = (props: { readonly x: number; readonly y: number; readonly fill: string; readonly anchor: "start" | "end"; readonly children: string }): React.ReactElement => (
  <RNSvgText x={props.x} y={props.y} fill={props.fill} fontSize={10} textAnchor={props.anchor}>
    {props.children}
  </RNSvgText>
);

/** Horizontal connected/lost timeline across the window. */
const Timeline = (props: { readonly outages: NetworkHealth["outages"]; readonly width: number; readonly from: number; readonly to: number }): React.ReactElement => {
  const h = 14;
  const w = props.width;
  const X = (t: number): number => Math.max(0, Math.min(w, ((t - props.from) / (props.to - props.from || 1)) * w));
  return (
    <Svg width={w} height={h}>
      <Rect x={0} y={0} width={w} height={h} rx={4} fill="rgba(50,215,75,0.35)" />
      {props.outages.map((o, i) => {
        const x = X(o.start);
        const xe = X(o.end ?? props.to);
        return <Rect key={i} x={x} y={0} width={Math.max(2, xe - x)} height={h} fill={RED} />;
      })}
    </Svg>
  );
};

type Props = NativeStackScreenProps<RootStackParamList, "ServerPrinterNetwork">;

export const PrinterNetworkScreen = (props: Props): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const background = useScreenBackground("grouped");
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { width } = useWindowDimensions();
  const [rangeLabel, setRangeLabel] = React.useState<string>("1h");
  // `?.` guards a nav state restored before this screen took params.
  const serverAddress = props.route.params?.serverAddress;
  const relayBase = serverAddress === undefined ? "" : relayBaseOf(serverAddress);
  const [spanMins, setSpanMins] = React.useState<number | undefined>(undefined);
  const ranges = React.useMemo(() => rangesFor(spanMins), [spanMins]);
  const selected = ranges.find((r) => r.label === rangeLabel) ?? ranges[0];
  const mins = selected.mins;
  const { data, error } = useNetwork(relayBase, mins);
  React.useEffect(() => {
    if (data?.dataStartMs != null) setSpanMins((data.updated - data.dataStartMs) / 60000);
  }, [data]);

  const now = data?.now;
  const pill = now?.prefreeze
    ? { label: "PRE-FREEZE", s: styles.pillBad }
    : now?.reachable === false
      ? { label: "UNREACHABLE", s: styles.pillBad }
      : now?.connection === "Connected"
        ? { label: "CONNECTED", s: styles.pillOk }
        : { label: (now?.connection ?? "—").toUpperCase(), s: styles.pillWarn };
  const cardW = width - 32;
  const chartW = cardW - 28;

  return (
    <ScrollView style={{ backgroundColor: background }} contentInsetAdjustmentBehavior="never" contentContainerStyle={{ padding: 16, paddingTop: headerHeight + 8, paddingBottom: insets.bottom + 48 }}>
      <View style={styles.top}>
        <View>
          <Text style={styles.h1}>Network</Text>
          <Text style={styles.sub}>{props.route.params?.serverName ?? "Printer"}</Text>
        </View>
        <View style={[styles.pill, pill.s]}>
          <Text style={[styles.pillText, pill.s]}>{pill.label}</Text>
        </View>
      </View>

      {data === undefined ? (
        <View style={styles.loading}>{error ? <Text style={styles.offline}>Can’t reach the relay.</Text> : <ActivityIndicator />}</View>
      ) : (
        <>
          {now?.prefreeze ? (
            <View style={styles.warn}>
              <Text style={styles.warnText}>The link looks like the pattern before a freeze: latency, loss, or a stale status.</Text>
            </View>
          ) : null}

          {/* Hero: current ping + loss */}
          <GlassView style={styles.hero} glassEffectStyle="regular" colorScheme={scheme}>
            <View style={styles.heroCol}>
              <Text style={styles.k}>Ping</Text>
              <Text style={styles.big}>
                {now?.rttMs != null ? now.rttMs.toFixed(1) : "—"}
                <Text style={styles.unit}> ms</Text>
              </Text>
            </View>
            <View style={styles.heroCol}>
              <Text style={styles.k}>Loss</Text>
              <Text style={styles.big}>
                {now?.lossPct != null ? now.lossPct.toFixed(0) : "—"}
                <Text style={styles.unit}> %</Text>
              </Text>
            </View>
            <View style={styles.heroCol}>
              <Text style={styles.k}>Status age</Text>
              <Text style={styles.big}>{fmtAge(now?.statusAgeMs ?? null)}</Text>
            </View>
          </GlassView>

          {/* Range selector */}
          <View style={styles.ranges}>
            {ranges.map((r) => (
              <Pressable key={r.label} onPress={() => setRangeLabel(r.label)} style={[styles.range, selected.label === r.label && styles.rangeOn]}>
                <Text style={[styles.rangeText, selected.label === r.label && styles.rangeTextOn]}>{r.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* Ping latency */}
          <GlassView style={styles.chartCard} glassEffectStyle="regular" colorScheme={scheme}>
            <View style={styles.chartHead}>
              <Text style={styles.k}>Ping latency</Text>
              <Text style={styles.chartMeta}>{data.stats.rttMin != null ? `${Math.round(data.stats.rttMin)}–${Math.round(data.stats.rttMax ?? 0)} ms · avg ${data.stats.rttAvg}` : ""}</Text>
            </View>
            <Chart data={data.series.rtt} width={chartW} color={ACCENT} unit="ms" min={0} dangerAbove={150} />
          </GlassView>

          {/* Status staleness */}
          <GlassView style={styles.chartCard} glassEffectStyle="regular" colorScheme={scheme}>
            <Text style={styles.k}>Status age</Text>
            <Chart data={data.series.statusAge.map((p) => [p[0], p[1] / 1000] as Point)} width={chartW} color={AMBER} unit="s" min={0} dangerAbove={30} />
          </GlassView>

          {/* Connection timeline */}
          <GlassView style={styles.chartCard} glassEffectStyle="regular" colorScheme={scheme}>
            <View style={styles.chartHead}>
              <Text style={styles.k}>Connection</Text>
              <Text style={styles.chartMeta}>{data.stats.disconnects > 0 ? `${data.stats.disconnects} drop${data.stats.disconnects > 1 ? "s" : ""}` : "steady"}</Text>
            </View>
            <Timeline outages={data.outages} width={chartW} from={data.from} to={data.to} />
          </GlassView>

          {/* Stats grid */}
          <View style={styles.statGrid}>
            <Stat styles={styles} label="Avg ping" value={data.stats.rttAvg != null ? `${data.stats.rttAvg} ms` : "—"} />
            <Stat styles={styles} label="Max ping" value={data.stats.rttMax != null ? `${Math.round(data.stats.rttMax)} ms` : "—"} />
            <Stat styles={styles} label="Loss" value={`${data.stats.lossPct}%`} />
            <Stat styles={styles} label="Drops" value={String(data.stats.disconnects)} />
            <Stat styles={styles} label="Worst age" value={fmtAge(data.stats.worstStatusAgeMs)} />
            <Stat styles={styles} label="Samples" value={String(data.stats.samples)} />
          </View>

          {/* Events */}
          <Text style={styles.sectionLabel}>Events</Text>
          <GlassView style={styles.events} glassEffectStyle="regular" colorScheme={scheme}>
            {data.events.length === 0 ? (
              <Text style={styles.eventNone}>No events — the link held.</Text>
            ) : (
              [...data.events].reverse().map((e, i, all) => (
                <View key={`${e.t}-${i}`} style={[styles.eventRow, i === all.length - 1 && styles.eventLast]}>
                  <View style={[styles.eventDot, { backgroundColor: e.kind === "reconnect" ? GREEN : e.kind === "prefreeze" ? AMBER : RED }]} />
                  <Text style={styles.eventMsg}>{e.message}</Text>
                  <Text style={styles.eventTime}>{new Date(e.t).toLocaleTimeString()}</Text>
                </View>
              ))
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
    warn: { backgroundColor: "rgba(255,69,58,0.14)", borderRadius: 14, padding: 14, marginBottom: 14 },
    warnText: { color: text.label, fontSize: 14, fontWeight: "600" },
    hero: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 20, padding: 18, overflow: "hidden", marginBottom: 14 },
    heroCol: { alignItems: "flex-start" },
    big: { color: text.label, fontSize: 26, fontWeight: "800", fontVariant: ["tabular-nums"], marginTop: 2 },
    unit: { color: text.secondaryLabel, fontSize: 14, fontWeight: "600" },
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
    eventRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: text.tertiaryLabel, gap: 10 },
    eventLast: { borderBottomWidth: 0 },
    eventDot: { width: 8, height: 8, borderRadius: 4 },
    eventTime: { color: text.secondaryLabel, fontSize: 11, fontVariant: ["tabular-nums"] },
    eventMsg: { color: text.label, fontSize: 13, flex: 1 },
    eventNone: { color: text.secondaryLabel, fontSize: 13, paddingVertical: 12 },
    foot: { color: text.secondaryLabel, fontSize: 11, textAlign: "center", marginTop: 16 },
  });
