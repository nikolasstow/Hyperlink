/**
 * The printer's camera on the printer page.
 *
 * Phones cannot open the printer's RTSP stream either, so the camera comes
 * through the relay. The card embeds the relay's own camera page
 * (`/?view=camera&bare=1`): on the relay's HTTPS address it plays the
 * camera's H.264 at 30 fps (WebCodecs needs a secure page); on plain HTTP it
 * shows MJPEG at 10 fps. The view exists only while watching, so the relay
 * turns the printer's stream off again soon after.
 *
 * @internal
 */
import * as React from "react";
import { AppState, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { SystemIcon } from "../SystemIcon";
import { useTextColors } from "../theme";
import { Card, Chip } from "./ui";

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

/**
 * The camera card. With `autoStart` (the camera's own page) the feed starts
 * as soon as the card shows, and again when the app comes back to the
 * foreground; otherwise it waits for a tap.
 */
export const PrinterCamera = (props: { readonly relayBase: string; readonly secureUrl: string | undefined; readonly reachable: boolean; readonly autoStart?: boolean }): React.ReactElement => {
  const text = useTextColors();
  const insets = useSafeAreaInsets();
  const autoStart = props.autoStart === true;
  const [wanted, setWatching] = React.useState(autoStart);
  const [full, setFull] = React.useState(false);
  const watching = wanted && props.reachable;
  const base = props.secureUrl ?? props.relayBase;
  const uri = `${base}/?view=camera&bare=1`;

  // Leaving the app stops watching, so the printer's stream slot is freed. Coming back restarts an auto-start feed.
  React.useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        setWatching(false);
        setFull(false);
      } else if (autoStart) {
        setWatching(true);
      }
    });
    return () => subscription.remove();
  }, [autoStart]);

  const right = (
    <View style={styles.actions}>
      {watching ? <Chip tone="uv" label={props.secureUrl !== undefined ? "Live" : "Live · 10 fps"} /> : null}
      {watching ? (
        <Pressable hitSlop={8} onPress={() => setFull(true)} accessibilityLabel="Full screen">
          <SystemIcon name="arrow.up.left.and.arrow.down.right" size={16} color={text.secondaryLabel} weight="semibold" />
        </Pressable>
      ) : null}
      {watching ? (
        <Pressable hitSlop={8} onPress={() => setWatching(false)} accessibilityLabel="Stop watching">
          <SystemIcon name="stop.fill" size={14} color={text.secondaryLabel} />
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <Card title="Camera" right={right}>
      <View style={styles.frame}>
        {watching && !full ? (
          <CameraView uri={uri} />
        ) : (
          <Pressable style={styles.idle} disabled={!props.reachable} onPress={() => setWatching(true)} accessibilityLabel="Watch the camera">
            <View style={styles.play}>
              <SystemIcon name={full ? "pip" : "play.fill"} size={20} color="#ffffff" />
            </View>
            <Text style={styles.idleText}>{!props.reachable ? "The camera needs the relay, which is not reachable" : full ? "Playing full screen" : "Watch live"}</Text>
          </Pressable>
        )}
      </View>
      <Modal visible={full} animationType="fade" presentationStyle="fullScreen" supportedOrientations={["portrait", "landscape"]} onRequestClose={() => setFull(false)}>
        <View style={styles.fullScreen}>
          {full ? <CameraView uri={uri} /> : null}
          <Pressable style={[styles.close, { top: insets.top + 12 }]} hitSlop={10} onPress={() => setFull(false)} accessibilityLabel="Close full screen">
            <SystemIcon name="xmark" size={15} color="#ffffff" weight="bold" />
          </Pressable>
        </View>
      </Modal>
    </Card>
  );
};

const styles = StyleSheet.create({
  actions: { flexDirection: "row", alignItems: "center", gap: 14 },
  frame: { aspectRatio: 16 / 9, borderRadius: 14, overflow: "hidden", backgroundColor: "#000000" },
  web: { flex: 1, backgroundColor: "#000000" },
  idle: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  play: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(143,115,255,0.55)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.3)" },
  idleText: { color: "rgba(244,245,249,0.7)", fontSize: 13, textAlign: "center", paddingHorizontal: 24 },
  fullScreen: { flex: 1, backgroundColor: "#000000" },
  close: { position: "absolute", right: 16, width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.55)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.25)" },
});
