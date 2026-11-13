/**
 * One camera's recordings, played in the app: the server reads Frigate with
 * its own login (`/cameras/frigate/...`), so the app needs no Frigate login
 * and never opens Safari.
 *
 * Laid out like Frigate's own pages: the player on top, then the review list
 * (alerts and detections, newest first, with Frigate's thumbnails), then the
 * 24/7 video by day and hour (Frigate's History).
 *
 * @internal
 */
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { requireOptionalNativeModule } from "expo";
import * as React from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { authedFetch, authedSource, authHeaders } from "./auth/serverTokens";
import { CAMERAS_API_PORT, type CameraInfo, useCameras } from "./CamerasScreen";
import type { RecordingPlayerProps } from "./RecordingPlayer";
import type { RootStackParamList } from "./RootNavigator";
import { type TextColors, useScreenBackground, useThemedStyles } from "./theme";

type Props = NativeStackScreenProps<RootStackParamList, "ServerCameraRecordings">;

const ACCENT = "#0a84ff";
const PAGE = 30;
/** Seconds of video before and after a review item. */
const LEAD_S = 10;

/** True when this build has expo-video; a build from before it has no player. */
const hasVideoPlayer = requireOptionalNativeModule("ExpoVideo") !== null;
/** Loaded only with the native module: its import needs it. */
const Player: React.ComponentType<RecordingPlayerProps> | undefined = hasVideoPlayer
  ? React.lazy(() => import("./RecordingPlayer").then((module) => ({ default: module.RecordingPlayer })))
  : undefined;

/** A Frigate review item: an alert or a detection. */
interface ReviewItem {
  readonly id: string;
  readonly camera: string;
  readonly start_time: number;
  readonly end_time: number | null;
  readonly severity: "alert" | "detection";
  readonly thumb_path: string;
  readonly data: { readonly objects: ReadonlyArray<string>; readonly audio?: ReadonlyArray<string> };
}

/** Frigate's recording summary: one entry per day, with the seconds recorded in each hour. */
interface DaySummary {
  readonly day: string;
  readonly hours: ReadonlyArray<{ readonly hour: string; readonly duration: number; readonly events: number }>;
}

interface Clip {
  readonly title: string;
  readonly start: number;
  readonly end: number;
}

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const clockOf = (seconds: number): string => new Date(seconds * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const dayOf = (seconds: number): string => new Date(seconds * 1000).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
const lengthOf = (seconds: number): string => (seconds < 60 ? `${Math.round(seconds)} s` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`);
const hourLabel = (hour: number): string => `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "AM" : "PM"}`;

/** The start of `day` (YYYY-MM-DD) at `hour`, on this phone's clock. */
const hourStart = (day: string, hour: number): number => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1, hour).getTime() / 1000;
};

const fetchJson = async <A,>(url: string): Promise<A> => {
  const response = await authedFetch(url);
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  return (await response.json()) as A;
};

export const CameraRecordingsScreen = (props: Props): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const background = useScreenBackground("grouped");
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { width } = useWindowDimensions();
  const { serverAddress, cameraId } = props.route.params;
  const base = `http://${serverAddress}:${CAMERAS_API_PORT}`;
  const frigate = `${base}/cameras/frigate`;
  const { list, error: listError } = useCameras(base);
  const [selected, setSelected] = React.useState<string | undefined>(cameraId);
  const camera: CameraInfo | undefined = list?.cameras.find((each) => each.id === selected) ?? list?.cameras[0];
  const name = camera?.frigate ?? camera?.id;
  const [items, setItems] = React.useState<ReadonlyArray<ReviewItem> | undefined>(undefined);
  const [more, setMore] = React.useState(false);
  const [days, setDays] = React.useState<ReadonlyArray<DaySummary> | undefined>(undefined);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [clip, setClip] = React.useState<Clip | undefined>(undefined);
  const cardW = width - 32;
  const playerH = Math.round((cardW * 9) / 16);

  const loadItems = React.useCallback(
    (before: number | undefined) => {
      if (name === undefined) return;
      const query = `cameras=${encodeURIComponent(name)}&limit=${PAGE}${before === undefined ? "" : `&before=${before}`}`;
      fetchJson<ReadonlyArray<ReviewItem>>(`${frigate}/api/review?${query}`)
        .then((next) => {
          setItems((current) => (before === undefined ? next : [...(current ?? []), ...next]));
          setMore(next.length === PAGE);
        })
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
    },
    [frigate, name],
  );

  React.useEffect(() => {
    if (name === undefined) return;
    setItems(undefined);
    setDays(undefined);
    setError(undefined);
    loadItems(undefined);
    fetchJson<ReadonlyArray<DaySummary>>(`${frigate}/api/${encodeURIComponent(name)}/recordings/summary?timezone=${encodeURIComponent(timeZone)}`)
      .then(setDays)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [frigate, loadItems, name]);

  const vodUri = clip === undefined || name === undefined ? undefined : `${frigate}/vod/${encodeURIComponent(name)}/start/${Math.floor(clip.start)}/end/${Math.ceil(clip.end)}/index.m3u8`;
  const now = Date.now() / 1000;

  return (
    <ScrollView style={{ backgroundColor: background }} contentInsetAdjustmentBehavior="never" contentContainerStyle={{ padding: 16, paddingTop: headerHeight + 8, paddingBottom: insets.bottom + 48 }}>
      <View style={styles.chips}>
        {(list?.cameras ?? []).map((each) => (
          <Pressable
            key={each.id}
            style={[styles.chip, each.id === camera?.id && styles.chipOn]}
            onPress={() => {
              setSelected(each.id);
              setClip(undefined);
            }}
          >
            <Text style={[styles.chipText, each.id === camera?.id && styles.chipTextOn]}>{each.name}</Text>
          </Pressable>
        ))}
      </View>

      <View style={[styles.player, { height: playerH }]}>
        {Player === undefined ? (
          <Text style={styles.playerNote}>This build has no video player. Install the new DoubleAgent · iota build.</Text>
        ) : vodUri === undefined ? (
          <Text style={styles.playerNote}>Pick an event or an hour.</Text>
        ) : (
          <React.Suspense fallback={<ActivityIndicator color="#ffffff" />}>
            <Player key={vodUri} uri={vodUri} headers={authHeaders(vodUri)} />
          </React.Suspense>
        )}
      </View>
      <Text style={styles.playing}>{clip === undefined ? " " : clip.title}</Text>

      {listError !== undefined || error !== undefined ? <Text style={styles.error}>{listError ?? error}</Text> : null}

      <Text style={styles.sectionLabel}>Alerts and detections</Text>
      {items === undefined ? (
        <ActivityIndicator style={styles.spinner} />
      ) : items.length === 0 ? (
        <Text style={styles.empty}>No events.</Text>
      ) : (
        <View style={styles.list}>
          {items.map((item) => {
            const end = item.end_time ?? now;
            const label = [...item.data.objects, ...(item.data.audio ?? [])].join(", ") || "Motion";
            return (
              <Pressable
                key={item.id}
                style={({ pressed }) => [styles.item, pressed && { opacity: 0.6 }]}
                onPress={() =>
                  setClip({
                    title: `${label} · ${dayOf(item.start_time)} ${clockOf(item.start_time)}`,
                    start: item.start_time - LEAD_S,
                    end: Math.min(end + LEAD_S, now),
                  })
                }
              >
                <Image style={styles.itemThumb} source={authedSource(`${frigate}/${item.thumb_path.replace(/^\/media\/frigate\//, "")}`)} resizeMode="cover" />
                <View style={styles.itemText}>
                  <View style={styles.itemTop}>
                    <View style={[styles.dot, { backgroundColor: item.severity === "alert" ? "#ff453a" : "#ff9f0a" }]} />
                    <Text style={styles.itemTitle} numberOfLines={1}>
                      {label}
                    </Text>
                  </View>
                  <Text style={styles.itemSub}>
                    {dayOf(item.start_time)} · {clockOf(item.start_time)} · {item.end_time === null ? "in progress" : lengthOf(end - item.start_time)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          {more ? (
            <Pressable style={styles.more} onPress={() => loadItems(items[items.length - 1]?.start_time)}>
              <Text style={styles.moreText}>Show older events</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      <Text style={styles.sectionLabel}>24/7 video</Text>
      {days === undefined ? (
        <ActivityIndicator style={styles.spinner} />
      ) : (
        days.map((day) => (
          <View key={day.day} style={styles.day}>
            <Text style={styles.dayTitle}>{dayOf(hourStart(day.day, 12))}</Text>
            <View style={styles.hours}>
              {[...day.hours]
                .sort((a, b) => Number(a.hour) - Number(b.hour))
                .map((entry) => {
                  const hour = Number(entry.hour);
                  const start = hourStart(day.day, hour);
                  const percent = Math.min(100, Math.round((entry.duration / Math.min(3600, Math.max(1, now - start))) * 100));
                  return (
                    <Pressable
                      key={entry.hour}
                      style={({ pressed }) => [styles.hour, pressed && { opacity: 0.6 }]}
                      onPress={() => setClip({ title: `${dayOf(start)} · ${hourLabel(hour)}`, start, end: Math.min(start + 3600, now) })}
                    >
                      <Text style={styles.hourText}>{hourLabel(hour)}</Text>
                      <View style={styles.bar}>
                        <View style={[styles.barFill, { width: `${percent}%` }]} />
                      </View>
                    </Pressable>
                  );
                })}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    chips: { flexDirection: "row", gap: 8, marginBottom: 12 },
    chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: "rgba(120,120,128,0.16)" },
    chipOn: { backgroundColor: "rgba(10,132,255,0.18)" },
    chipText: { color: text.secondaryLabel, fontSize: 14, fontWeight: "500" },
    chipTextOn: { color: ACCENT, fontWeight: "600" },
    player: { borderRadius: 20, overflow: "hidden", backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
    playerNote: { color: "rgba(255,255,255,0.7)", fontSize: 14, textAlign: "center", paddingHorizontal: 24 },
    playing: { color: text.secondaryLabel, fontSize: 12, textAlign: "center", marginTop: 8, marginBottom: 14 },
    error: { color: "#ff453a", fontSize: 13, marginBottom: 12 },
    sectionLabel: { color: text.secondaryLabel, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3, marginLeft: 2, marginBottom: 8 },
    spinner: { marginVertical: 20 },
    empty: { color: text.secondaryLabel, fontSize: 14, marginBottom: 18, marginLeft: 2 },
    list: { gap: 8, marginBottom: 22 },
    item: { flexDirection: "row", alignItems: "center", gap: 12 },
    itemThumb: { width: 112, height: 63, borderRadius: 10, backgroundColor: "#000" },
    itemText: { flex: 1, minWidth: 0 },
    itemTop: { flexDirection: "row", alignItems: "center", gap: 6 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    itemTitle: { color: text.label, fontSize: 15, fontWeight: "600", textTransform: "capitalize", flexShrink: 1 },
    itemSub: { color: text.secondaryLabel, fontSize: 12, marginTop: 3 },
    more: { paddingVertical: 10, alignItems: "center" },
    moreText: { color: ACCENT, fontSize: 15, fontWeight: "600" },
    day: { marginBottom: 16 },
    dayTitle: { color: text.label, fontSize: 15, fontWeight: "600", marginBottom: 8, marginLeft: 2 },
    hours: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    hour: { width: 62, paddingVertical: 7, borderRadius: 8, backgroundColor: "rgba(120,120,128,0.16)", alignItems: "center", gap: 5 },
    hourText: { color: text.label, fontSize: 12, fontWeight: "600" },
    bar: { width: 44, height: 3, borderRadius: 2, backgroundColor: "rgba(120,120,128,0.3)", overflow: "hidden" },
    barFill: { height: 3, backgroundColor: ACCENT },
  });
