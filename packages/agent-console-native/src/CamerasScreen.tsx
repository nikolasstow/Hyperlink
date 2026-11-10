/**
 * The home cameras on a server: one camera live, the others as frames that
 * refresh, and a link to Frigate's recordings. The backend's `/cameras`
 * routes (agent-console `src/server/cameras.ts`) read them from go2rtc.
 *
 * The live camera plays in the printer's Picture in Picture view: the same
 * H.264 WebSocket format, and the same audio session that mixes with other
 * apps, so music or a video in another app does not pause it. Leaving the app
 * while the page is open starts the window.
 *
 * Laid out like the UPS page (ServerUpsScreen.tsx): title row, glass cards.
 *
 * @internal
 */
import { useIsFocused } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, useColorScheme, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PrinterPip } from "../modules/printer-pip";
import { authedFetch, authedSource, tokenFor } from "./auth/serverTokens";
import type { RootStackParamList } from "./RootNavigator";
import { type TextColors, useScreenBackground, useThemedStyles } from "./theme";

type Props = NativeStackScreenProps<RootStackParamList, "ServerCameras">;

/** The Effect API server, where the camera routes are. */
const API_PORT = 5199;
/** How often the other cameras' frames refresh. */
const FRAME_MS = 5000;
const ACCENT = "#0a84ff";

interface CameraInfo {
  readonly id: string;
  readonly name: string;
}
interface CameraList {
  readonly cameras: ReadonlyArray<CameraInfo>;
  readonly frigate?: string;
}

const useCameras = (base: string): { readonly list: CameraList | undefined; readonly error: string | undefined } => {
  const [list, setList] = React.useState<CameraList | undefined>(undefined);
  const [error, setError] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    let live = true;
    authedFetch(`${base}/cameras`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
        return (await response.json()) as CameraList;
      })
      .then((next) => {
        if (live) setList(next);
      })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      live = false;
    };
  }, [base]);
  return { list, error };
};

/** A clock that ticks every `ms` while `on`, to refresh frames. */
const useTick = (ms: number, on: boolean): number => {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setTick((value) => value + 1), ms);
    return () => clearInterval(timer);
  }, [ms, on]);
  return tick;
};

export const CamerasScreen = (props: Props): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const background = useScreenBackground("grouped");
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { width } = useWindowDimensions();
  const focused = useIsFocused();
  const serverAddress = props.route.params?.serverAddress;
  const base = serverAddress === undefined ? "" : `http://${serverAddress}:${API_PORT}`;
  const { list, error } = useCameras(base);
  const [selected, setSelected] = React.useState<string | undefined>(undefined);
  const current = list?.cameras.find((camera) => camera.id === selected) ?? list?.cameras[0];
  const tick = useTick(FRAME_MS, focused);
  const cardW = width - 32;
  const liveH = Math.round((cardW * 9) / 16);
  const others = list?.cameras.filter((camera) => camera.id !== current?.id) ?? [];
  const thumbW = (cardW - 10) / 2;

  return (
    <ScrollView style={{ backgroundColor: background }} contentInsetAdjustmentBehavior="never" contentContainerStyle={{ padding: 16, paddingTop: headerHeight + 8, paddingBottom: insets.bottom + 48 }}>
      <View style={styles.top}>
        <View>
          <Text style={styles.h1}>{current?.name ?? "Cameras"}</Text>
          <Text style={styles.sub}>{list === undefined ? " " : `${list.cameras.length} camera${list.cameras.length === 1 ? "" : "s"} · go2rtc`}</Text>
        </View>
        {current === undefined ? null : (
          <View style={[styles.pill, styles.pillOk]}>
            <Text style={[styles.pillText, styles.pillOk]}>LIVE</Text>
          </View>
        )}
      </View>

      {list === undefined || current === undefined ? (
        <View style={styles.loading}>{error === undefined ? <ActivityIndicator /> : <Text style={styles.offline}>Can’t reach the cameras: {error}</Text>}</View>
      ) : (
        <>
          <View style={[styles.live, { height: liveH }]}>
            <PrinterPip
              key={current.id}
              style={StyleSheet.absoluteFill}
              mode="camera"
              cameraUrl={`${base.replace(/^http/, "ws")}/cameras/h264?id=${encodeURIComponent(current.id)}`}
              relayToken={tokenFor(base)}
              layerUri={undefined}
              tint="#ffffff"
              aspect={16 / 9}
              phase={undefined}
              exposing={false}
              active={false}
              glowColor="#ffffff"
              phaseColor="#ffffff"
              dotColor="#ffffff"
              percent={undefined}
              elapsedMs={undefined}
              remainingMs={undefined}
              enabled={focused}
            />
          </View>
          <Text style={styles.hint}>Leave the app to keep watching in Picture in Picture.</Text>

          {others.length === 0 ? null : (
            <>
              <Text style={styles.sectionLabel}>Other cameras</Text>
              <View style={styles.grid}>
                {others.map((camera) => (
                  <Pressable key={camera.id} onPress={() => setSelected(camera.id)} style={{ width: thumbW }}>
                    <Image style={[styles.thumb, { height: Math.round((thumbW * 9) / 16) }]} source={authedSource(`${base}/cameras/frame?id=${encodeURIComponent(camera.id)}&t=${tick}`)} resizeMode="cover" fadeDuration={0} />
                    <Text style={styles.thumbName}>{camera.name}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {list.frigate === undefined ? null : (
            <Pressable onPress={() => void Linking.openURL(list.frigate ?? "")}>
              <GlassView style={styles.row} glassEffectStyle="regular" colorScheme={scheme}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>Recordings</Text>
                  <Text style={styles.sub}>Frigate: playback, events, and storage</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </GlassView>
            </Pressable>
          )}
        </>
      )}
    </ScrollView>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
    h1: { color: text.label, fontSize: 22, fontWeight: "700" },
    sub: { color: text.secondaryLabel, fontSize: 12, marginTop: 2 },
    pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
    pillText: { fontSize: 13, fontWeight: "700" },
    pillOk: { backgroundColor: "rgba(50,215,75,0.16)", color: "#32d74b" },
    loading: { paddingVertical: 60, alignItems: "center" },
    offline: { color: text.secondaryLabel, fontSize: 14, textAlign: "center" },
    live: { borderRadius: 20, overflow: "hidden", backgroundColor: "#000" },
    hint: { color: text.secondaryLabel, fontSize: 12, textAlign: "center", marginTop: 8, marginBottom: 18 },
    sectionLabel: { color: text.secondaryLabel, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3, marginLeft: 2, marginBottom: 8 },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 18 },
    thumb: { width: "100%", borderRadius: 14, backgroundColor: "#000" },
    thumbName: { color: text.label, fontSize: 13, fontWeight: "600", marginTop: 6, marginLeft: 2 },
    row: { flexDirection: "row", alignItems: "center", borderRadius: 16, padding: 14, overflow: "hidden" },
    rowText: { flex: 1 },
    rowTitle: { color: text.label, fontSize: 15, fontWeight: "600" },
    chevron: { color: ACCENT, fontSize: 22, fontWeight: "600" },
  });
