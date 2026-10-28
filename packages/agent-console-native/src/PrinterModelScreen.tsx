/**
 * The print's 3D model: the model with its supports, as the printer cures
 * it, made by the relay from the sliced file. One finger turns it, two
 * fingers move it, and a pinch zooms. The app gets the model before the
 * owner opens this page (printer/layerPack.ts `watchForLayerPacks`), so it
 * shows at once.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ModelViewer } from "../modules/model-viewer";
import { usePrintModel } from "./printer/printModel";
import { usePalette } from "./printer/ui";
import type { RootStackParamList } from "./RootNavigator";
import { towardWhite, useScreenBackground, useTextColors } from "./theme";

type Props = NativeStackScreenProps<RootStackParamList, "ServerPrinterModel">;

export const PrinterModelScreen = (props: Props): React.ReactElement => {
  const { relayBase, taskId, filename } = props.route.params;
  const text = useTextColors();
  const palette = usePalette();
  const background = useScreenBackground("plain");
  const insets = useSafeAreaInsets();
  const { state, model } = usePrintModel(relayBase, taskId);
  const note =
    model !== undefined
      ? undefined
      : state?.kind === "Building"
        ? `The relay is making the model: layer ${state.done.toLocaleString()} of ${state.total.toLocaleString()}`
        : state?.kind === "Failed"
          ? `No model: ${state.reason}`
          : "Getting the model";
  return (
    <View style={[styles.page, { backgroundColor: background }]}>
      <ModelViewer style={StyleSheet.absoluteFill} uri={model?.uri} color={towardWhite(palette.accent, 0.6)} />
      {note !== undefined ? (
        <View style={styles.center} pointerEvents="none">
          <Text style={[styles.note, { color: text.secondaryLabel }]}>{note}</Text>
        </View>
      ) : null}
      <View style={[styles.footer, { bottom: insets.bottom + 12 }]} pointerEvents="none">
        <Text style={[styles.name, { color: text.label }]} numberOfLines={1}>
          {filename.replace(/\.goo$/i, "")}
        </Text>
        {model !== undefined ? <Text style={[styles.detail, { color: text.secondaryLabel }]}>{`${model.triangleCount.toLocaleString()} triangles`}</Text> : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  page: { flex: 1 },
  center: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  note: { fontSize: 15, textAlign: "center" },
  footer: { position: "absolute", left: 16, right: 16, alignItems: "center" },
  name: { fontSize: 15, fontWeight: "600" },
  detail: { fontSize: 13, marginTop: 2 },
});
