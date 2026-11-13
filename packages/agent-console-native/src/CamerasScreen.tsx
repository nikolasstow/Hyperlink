/**
 * The home cameras on a server: one camera live, the others as frames that
 * refresh, pan and tilt, and the recordings. The backend's `/cameras` routes
 * (agent-console `src/server/cameras.ts`) read them from go2rtc, the cameras'
 * ONVIF, and Frigate.
 *
 * The live camera plays in the printer's Picture in Picture view: the same
 * H.264 WebSocket format, and the same audio session that mixes with other
 * apps, so music or a video in another app does not pause it. Leaving the app
 * while the page is open starts the window. The window's skip buttons go to
 * the previous and the next camera (a build from before `cameraUrls` keeps the
 * printer's camera and layer switch).
 *
 * The live view is never remounted: a new camera, a new quality, and full
 * screen change its props and styles only, so the window stays open.
 *
 * Pinch to zoom, drag to move a zoomed view, and double-tap to zoom in or out,
 * as in Photos. Full screen turns the video to landscape, as the Tapo app does.
 *
 * Laid out like the UPS page (ServerUpsScreen.tsx): title row, glass cards.
 *
 * @internal
 */
import { useIsFocused } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { GlassView } from "expo-glass-effect";
import { StatusBar } from "expo-status-bar";
import * as React from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, useColorScheme, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PrinterPip } from "../modules/printer-pip";
import { authedFetch, authedSource, tokenFor } from "./auth/serverTokens";
import type { RootStackParamList } from "./RootNavigator";
import { SystemIcon } from "./SystemIcon";
import { type TextColors, useScreenBackground, useThemedStyles } from "./theme";

type Props = NativeStackScreenProps<RootStackParamList, "ServerCameras">;

/** The Effect API server, where the camera routes are. */
export const CAMERAS_API_PORT = 5199;
/** How often the other cameras' frames refresh. */
const FRAME_MS = 5000;
/** How often a held pan or tilt button sends another step. */
const PTZ_REPEAT_MS = 350;
const MAX_ZOOM = 6;
const ACCENT = "#0a84ff";

export interface CameraInfo {
  readonly id: string;
  readonly name: string;
  /** Frigate's name for the camera. */
  readonly frigate?: string;
  /** True when the server can pan and tilt the camera. */
  readonly ptz?: boolean;
  /** True when the camera has a sub stream, so `auto` and `low` quality work. */
  readonly sub?: boolean;
}
export interface CameraList {
  readonly cameras: ReadonlyArray<CameraInfo>;
  /** True when the server reads Frigate's recordings for the app. */
  readonly recordings?: boolean;
  readonly frigate?: string;
}

type Quality = "auto" | "high" | "low";
const QUALITIES: ReadonlyArray<{ readonly value: Quality; readonly label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "high", label: "HD" },
  { value: "low", label: "SD" },
];

export const useCameras = (base: string): { readonly list: CameraList | undefined; readonly error: string | undefined } => {
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

/** Keeps a zoomed view's edge inside the frame. */
const clampShift = (shift: number, scale: number, size: number): number => {
  "worklet";
  const max = (size * (scale - 1)) / 2;
  return Math.min(max, Math.max(-max, shift));
};

/**
 * Pinch, drag and double-tap zoom over a child of `width` × `height`.
 * `turned` is true when the child is turned 90° for full screen: then a drag
 * across the screen moves the picture along its own axes.
 */
const Zoomable = (props: { readonly width: number; readonly height: number; readonly turned: boolean; readonly children: React.ReactNode }): React.ReactElement => {
  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const { width, height, turned } = props;

  const gesture = React.useMemo(() => {
    const pinch = Gesture.Pinch()
      .onStart(() => {
        startScale.value = scale.value;
      })
      .onUpdate((event) => {
        scale.value = Math.min(MAX_ZOOM, Math.max(1, startScale.value * event.scale));
        x.value = clampShift(x.value, scale.value, width);
        y.value = clampShift(y.value, scale.value, height);
      });
    const pan = Gesture.Pan()
      .averageTouches(true)
      // At 1× a drag scrolls the page; only a zoomed view moves.
      .manualActivation(true)
      .onTouchesMove((_event, state) => {
        if (scale.value > 1.01) state.activate();
        else state.fail();
      })
      .onStart(() => {
        startX.value = x.value;
        startY.value = y.value;
      })
      .onUpdate((event) => {
        // Turned 90° clockwise: the screen's down is the picture's right.
        const dx = turned ? event.translationY : event.translationX;
        const dy = turned ? -event.translationX : event.translationY;
        x.value = clampShift(startX.value + dx / scale.value, scale.value, width);
        y.value = clampShift(startY.value + dy / scale.value, scale.value, height);
      });
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd(() => {
        const zoomIn = scale.value < 1.5;
        scale.value = withTiming(zoomIn ? 2.5 : 1);
        x.value = withTiming(0);
        y.value = withTiming(0);
      });
    return Gesture.Exclusive(doubleTap, Gesture.Simultaneous(pinch, pan));
  }, [height, scale, startScale, startX, startY, turned, width, x, y]);

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { translateX: x.value }, { translateY: y.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[StyleSheet.absoluteFill, zoomStyle]}>{props.children}</Animated.View>
    </GestureDetector>
  );
};

/** One pan and tilt button: a step on press, and more steps while held. */
const PtzButton = (props: {
  readonly icon: "chevron.up" | "chevron.down" | "chevron.left" | "chevron.right";
  readonly onStep: () => void;
  readonly style: object;
  readonly color: string;
}): React.ReactElement => {
  const timer = React.useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const stop = React.useCallback(() => {
    if (timer.current !== undefined) clearInterval(timer.current);
    timer.current = undefined;
  }, []);
  React.useEffect(() => stop, [stop]);
  return (
    <Pressable
      style={({ pressed }) => [props.style, { opacity: pressed ? 0.5 : 1 }]}
      hitSlop={6}
      onPressIn={() => {
        props.onStep();
        stop();
        timer.current = setInterval(props.onStep, PTZ_REPEAT_MS);
      }}
      onPressOut={stop}
    >
      <SystemIcon name={props.icon} size={22} color={props.color} />
    </Pressable>
  );
};

export const CamerasScreen = (props: Props): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const background = useScreenBackground("grouped");
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const window = useWindowDimensions();
  const focused = useIsFocused();
  const { navigation } = props;
  const serverName = props.route.params?.serverName;
  const serverAddress = props.route.params?.serverAddress;
  const base = serverAddress === undefined ? "" : `http://${serverAddress}:${CAMERAS_API_PORT}`;
  const { list, error } = useCameras(base);
  const [selected, setSelected] = React.useState<string | undefined>(undefined);
  const [quality, setQuality] = React.useState<Quality>("auto");
  const [full, setFull] = React.useState(false);
  const [ptzError, setPtzError] = React.useState<string | undefined>(undefined);
  const current = list?.cameras.find((camera) => camera.id === selected) ?? list?.cameras[0];
  const tick = useTick(FRAME_MS, focused && !full);
  const cardW = window.width - 32;
  const liveH = Math.round((cardW * 9) / 16);
  const others = list?.cameras.filter((camera) => camera.id !== current?.id) ?? [];
  const thumbW = (cardW - 10) / 2;

  React.useLayoutEffect(() => {
    navigation.setOptions({ headerShown: !full });
  }, [full, navigation]);

  const socketUrl = React.useCallback(
    (id: string) => `${base.replace(/^http/, "ws")}/cameras/h264?id=${encodeURIComponent(id)}&quality=${quality}`,
    [base, quality],
  );
  const cameraUrls = React.useMemo(() => list?.cameras.map((camera) => socketUrl(camera.id)) ?? [], [list, socketUrl]);

  const step = React.useCallback(
    (pan: number, tilt: number) => {
      if (current === undefined) return;
      authedFetch(`${base}/cameras/ptz?id=${encodeURIComponent(current.id)}&pan=${pan}&tilt=${tilt}`, { method: "POST" })
        .then(async (response) => setPtzError(response.ok ? undefined : `${response.status}: ${await response.text()}`))
        .catch((cause: unknown) => setPtzError(cause instanceof Error ? cause.message : String(cause)));
    },
    [base, current],
  );

  // Full screen: the video turned to landscape over the whole screen.
  const frameW = full ? window.width : cardW;
  const frameH = full ? window.height : liveH;
  const videoW = full ? window.height : cardW;
  const videoH = full ? window.width : liveH;

  return (
    <ScrollView
      style={{ backgroundColor: full ? "#000" : background }}
      scrollEnabled={!full}
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={full ? styles.fullContent : { padding: 16, paddingTop: headerHeight + 8, paddingBottom: insets.bottom + 48 }}
    >
      <StatusBar hidden={full} />
      {full ? null : (
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
      )}

      {list === undefined || current === undefined ? (
        <View style={styles.loading}>{error === undefined ? <ActivityIndicator /> : <Text style={styles.offline}>Can’t reach the cameras: {error}</Text>}</View>
      ) : (
        <View style={[styles.live, { width: frameW, height: frameH }, full ? styles.liveFull : null]}>
          <View
            style={
              full
                ? {
                    position: "absolute",
                    width: videoW,
                    height: videoH,
                    left: (frameW - videoW) / 2,
                    top: (frameH - videoH) / 2,
                    transform: [{ rotate: "90deg" }],
                  }
                : StyleSheet.absoluteFill
            }
          >
            <Zoomable width={videoW} height={videoH} turned={full}>
              <PrinterPip
                style={StyleSheet.absoluteFill}
                mode="camera"
                cameraUrl={socketUrl(current.id)}
                cameraUrls={cameraUrls}
                onSwitchCamera={(event) => setSelected(list.cameras[event.nativeEvent.index]?.id)}
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
            </Zoomable>
            <Pressable style={[styles.fullButton, full ? { right: insets.bottom + 12 } : null]} hitSlop={10} onPress={() => setFull((value) => !value)}>
              <SystemIcon name={full ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right"} size={16} color="#ffffff" />
            </Pressable>
            {full ? <Text style={[styles.fullName, { left: insets.top + 16 }]}>{current.name}</Text> : null}
          </View>
        </View>
      )}

      {full || list === undefined || current === undefined ? null : (
        <>
          <View style={styles.controls}>
            <View style={styles.segments}>
              {QUALITIES.map((option) => (
                <Pressable
                  key={option.value}
                  disabled={current.sub !== true && option.value !== "high"}
                  style={[styles.segment, quality === option.value && styles.segmentOn]}
                  onPress={() => setQuality(option.value)}
                >
                  <Text style={[styles.segmentText, quality === option.value && styles.segmentTextOn]}>{option.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.hintInline}>Pinch to zoom</Text>
          </View>
          <Text style={styles.hint}>Leave the app to keep watching in Picture in Picture. Its skip buttons change the camera.</Text>

          {current.ptz === true ? (
            <View style={styles.ptzWrap}>
              <GlassView style={styles.ptz} glassEffectStyle="regular" colorScheme={scheme}>
                <PtzButton icon="chevron.up" color={ACCENT} style={[styles.ptzButton, styles.ptzUp]} onStep={() => step(0, 1)} />
                <PtzButton icon="chevron.left" color={ACCENT} style={[styles.ptzButton, styles.ptzLeft]} onStep={() => step(-1, 0)} />
                <PtzButton icon="chevron.right" color={ACCENT} style={[styles.ptzButton, styles.ptzRight]} onStep={() => step(1, 0)} />
                <PtzButton icon="chevron.down" color={ACCENT} style={[styles.ptzButton, styles.ptzDown]} onStep={() => step(0, -1)} />
              </GlassView>
              {ptzError === undefined ? null : <Text style={styles.offline}>Pan and tilt failed: {ptzError}</Text>}
            </View>
          ) : null}

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

          {list.recordings === true && serverName !== undefined && serverAddress !== undefined ? (
            <Pressable onPress={() => navigation.navigate("ServerCameraRecordings", { serverName, serverAddress, cameraId: current.id })}>
              <GlassView style={styles.row} glassEffectStyle="regular" colorScheme={scheme}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>Recordings</Text>
                  <Text style={styles.sub}>Events and 24/7 video from Frigate</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </GlassView>
            </Pressable>
          ) : null}
        </>
      )}
    </ScrollView>
  );
};

const PTZ_SIZE = 156;
const PTZ_BUTTON = 52;

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
    h1: { color: text.label, fontSize: 22, fontWeight: "700" },
    sub: { color: text.secondaryLabel, fontSize: 12, marginTop: 2 },
    pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
    pillText: { fontSize: 13, fontWeight: "700" },
    pillOk: { backgroundColor: "rgba(50,215,75,0.16)", color: "#32d74b" },
    loading: { paddingVertical: 60, alignItems: "center" },
    offline: { color: text.secondaryLabel, fontSize: 14, textAlign: "center", marginTop: 8 },
    fullContent: { flexGrow: 1 },
    live: { borderRadius: 20, overflow: "hidden", backgroundColor: "#000" },
    liveFull: { borderRadius: 0 },
    fullButton: {
      position: "absolute",
      right: 12,
      bottom: 12,
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(0,0,0,0.45)",
    },
    fullName: { position: "absolute", left: 16, top: 12, color: "#ffffff", fontSize: 15, fontWeight: "600" },
    controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 },
    segments: { flexDirection: "row", gap: 6 },
    segment: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: "rgba(120,120,128,0.16)" },
    segmentOn: { backgroundColor: "rgba(10,132,255,0.18)" },
    segmentText: { color: text.secondaryLabel, fontSize: 14, fontWeight: "500" },
    segmentTextOn: { color: ACCENT, fontWeight: "600" },
    hintInline: { color: text.secondaryLabel, fontSize: 12 },
    hint: { color: text.secondaryLabel, fontSize: 12, textAlign: "center", marginTop: 10, marginBottom: 18 },
    ptzWrap: { alignItems: "center", marginBottom: 22 },
    ptz: { width: PTZ_SIZE, height: PTZ_SIZE, borderRadius: PTZ_SIZE / 2, overflow: "hidden" },
    ptzButton: { position: "absolute", width: PTZ_BUTTON, height: PTZ_BUTTON, alignItems: "center", justifyContent: "center" },
    ptzUp: { top: 2, left: (PTZ_SIZE - PTZ_BUTTON) / 2 },
    ptzDown: { bottom: 2, left: (PTZ_SIZE - PTZ_BUTTON) / 2 },
    ptzLeft: { left: 2, top: (PTZ_SIZE - PTZ_BUTTON) / 2 },
    ptzRight: { right: 2, top: (PTZ_SIZE - PTZ_BUTTON) / 2 },
    sectionLabel: { color: text.secondaryLabel, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3, marginLeft: 2, marginBottom: 8 },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 18 },
    thumb: { width: "100%", borderRadius: 14, backgroundColor: "#000" },
    thumbName: { color: text.label, fontSize: 13, fontWeight: "600", marginTop: 6, marginLeft: 2 },
    row: { flexDirection: "row", alignItems: "center", borderRadius: 16, padding: 14, overflow: "hidden" },
    rowText: { flex: 1 },
    rowTitle: { color: text.label, fontSize: 15, fontWeight: "600" },
    chevron: { color: ACCENT, fontSize: 22, fontWeight: "600" },
  });
