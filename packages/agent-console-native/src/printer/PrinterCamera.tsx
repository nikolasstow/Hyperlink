/**
 * The printer's camera: page 2 of the stage pager (StagePager.tsx), at the
 * LCD's size.
 *
 * Phones cannot open the printer's RTSP stream either, so the camera comes
 * through the relay. The pane embeds the relay's own camera page
 * (`/?view=camera&bare=1`): on the relay's HTTPS address it plays the
 * camera's H.264 at 30 fps (WebCodecs needs a secure page); on plain HTTP it
 * shows MJPEG at 10 fps. The view exists only while its page shows and the
 * app is in the foreground, so the relay turns the printer's stream off again
 * soon after.
 *
 * @internal
 */
import * as React from "react";
import { AppState, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { SystemIcon } from "../SystemIcon";
import { withAlpha } from "../theme";
import { Chip, usePalette } from "./ui";

const CameraView = (props: { readonly uri: string }): React.ReactElement => (
  <WebView
    source={{ uri: props.uri }}
    style={styles.web}
    containerStyle={styles.web}
    originWhitelist={["*"]}
    allowsInlineMediaPlayback
    mediaPlaybackRequiresUserAction={false}
    scrollEnabled={false}
    bounces={false}
    javaScriptEnabled
    setSupportMultipleWindows={false}
  />
);

/** True while the app is in the foreground. */
const useForeground = (): boolean => {
  const [active, setActive] = React.useState(AppState.currentState === "active");
  React.useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setActive(state === "active"));
    return () => subscription.remove();
  }, []);
  return active;
};

/** The camera pane. `visible` is true while its page shows: the feed runs only then. */
export const CameraPane = (props: {
  readonly relayBase: string;
  readonly secureUrl: string | undefined;
  readonly reachable: boolean;
  readonly visible: boolean;
  readonly width: number;
  readonly height: number;
}): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const foreground = useForeground();
  const [full, setFull] = React.useState(false);
  const watching = props.visible && props.reachable && foreground;
  const uri = `${props.secureUrl ?? props.relayBase}/?view=camera&bare=1`;
  // Leaving the app closes the full-screen view too, so the printer's stream slot is freed.
  if (full && !foreground) setFull(false);

  return (
    <View style={[styles.frame, { width: props.width, height: props.height }]}>
      {watching && !full ? (
        <CameraView uri={uri} />
      ) : (
        <View style={styles.idle}>
          <View style={[styles.play, { backgroundColor: withAlpha(palette.accent, 0.55) }]}>
            <SystemIcon name={full ? "pip" : "video.fill"} size={20} color="#ffffff" />
          </View>
          <Text style={styles.idleText}>{!props.reachable ? "The camera needs the relay, which is not reachable" : full ? "Playing full screen" : "Camera"}</Text>
        </View>
      )}
      {watching && !full ? (
        <>
          <View style={styles.live}>
            <Chip tone="uv" label={props.secureUrl !== undefined ? "Live" : "Live · 10 fps"} />
          </View>
          <Pressable style={styles.expand} hitSlop={10} onPress={() => setFull(true)} accessibilityLabel="Full screen">
            <SystemIcon name="arrow.up.left.and.arrow.down.right" size={14} color="#ffffff" weight="semibold" />
          </Pressable>
        </>
      ) : null}
      <Modal visible={full} animationType="fade" presentationStyle="fullScreen" supportedOrientations={["portrait", "landscape"]} onRequestClose={() => setFull(false)}>
        <View style={styles.fullScreen}>
          {full ? <CameraView uri={uri} /> : null}
          <Pressable style={[styles.close, { top: insets.top + 12 }]} hitSlop={10} onPress={() => setFull(false)} accessibilityLabel="Close full screen">
            <SystemIcon name="xmark" size={15} color="#ffffff" weight="bold" />
          </Pressable>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  frame: { borderRadius: 16, overflow: "hidden", backgroundColor: "#000000" },
  web: { flex: 1, backgroundColor: "#000000" },
  idle: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  play: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.3)" },
  idleText: { color: "rgba(244,245,249,0.7)", fontSize: 13, textAlign: "center", paddingHorizontal: 24 },
  live: { position: "absolute", top: 8, left: 8 },
  expand: { position: "absolute", top: 8, right: 8, width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.55)" },
  fullScreen: { flex: 1, backgroundColor: "#000000" },
  close: { position: "absolute", right: 16, width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.55)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.25)" },
});
