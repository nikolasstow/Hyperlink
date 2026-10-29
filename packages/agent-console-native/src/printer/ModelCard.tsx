/**
 * The 3D model card on the printer page, above the print settings: the
 * progress of the print's 3D model on the relay and on the phone, then a
 * button that opens it (GooViewerScreen.tsx). The quick view opens as soon
 * as it is here; the card keeps showing the progress of the full detail.
 *
 * @internal
 */
import type { NavigationProp } from "@react-navigation/native";
import * as React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import type { RootStackParamList } from "../RootNavigator";
import { useTextColors, withAlpha } from "../theme";
import { usePrintModel, type LevelState, type ModelSource } from "./printModel";
import { printPreviewUrl } from "./relayApi";
import { Button, Card, usePalette } from "./ui";
import { authedSource } from "../auth/serverTokens";

/** A level's progress in words, and how far along it is (0 to 1) when that is known. */
const progressOf = (level: LevelState): { readonly label: string; readonly fraction: number | undefined; readonly done: boolean } => {
  if (level.model !== undefined) return { label: `Ready · ${level.model.triangleCount.toLocaleString()} triangles`, fraction: 1, done: true };
  const state = level.state;
  switch (state?.kind) {
    case "Building":
      return { label: `The relay is making it · layer ${state.done.toLocaleString()} of ${state.total.toLocaleString()}`, fraction: state.total > 0 ? state.done / state.total : 0, done: false };
    case "Failed":
      return { label: state.reason, fraction: undefined, done: false };
    case "Downloading":
    case "Ready":
    case undefined:
      return { label: "Coming to the phone", fraction: undefined, done: false };
  }
};

export const ModelCard = (props: {
  readonly relayBase: string;
  readonly taskId: string;
  readonly filename: string;
  readonly navigation: NavigationProp<RootStackParamList>;
}): React.ReactElement => {
  const text = useTextColors();
  const palette = usePalette();
  const source = React.useMemo((): ModelSource => ({ kind: "Print", taskId: props.taskId }), [props.taskId]);
  const { levels, best } = usePrintModel(props.relayBase, source);
  const rows: ReadonlyArray<readonly [string, LevelState]> = [
    ["Quick view", levels.low],
    ["Full detail", levels.high],
  ];
  return (
    <Card title="3D model">
      <View style={styles.body}>
        <Image source={authedSource(printPreviewUrl(props.relayBase, props.taskId))} style={styles.thumb} resizeMode="cover" />
        <View style={styles.rows}>
          {rows.map(([label, level]) => {
            const progress = progressOf(level);
            return (
              <View key={label} style={styles.row}>
                <View style={styles.rowTop}>
                  <Text style={[styles.label, { color: text.label }]}>{label}</Text>
                  {progress.fraction !== undefined && !progress.done ? (
                    <Text style={[styles.percent, { color: text.secondaryLabel }]}>{Math.floor(progress.fraction * 100)}%</Text>
                  ) : null}
                </View>
                <Text style={[styles.detail, { color: progress.done ? palette.ok : text.secondaryLabel }]} numberOfLines={2}>
                  {progress.label}
                </Text>
                {progress.fraction !== undefined && !progress.done ? (
                  <View style={[styles.track, { backgroundColor: withAlpha("#7F7F7F", 0.2) }]}>
                    <View style={[styles.fill, { width: `${Math.round(progress.fraction * 100)}%`, backgroundColor: palette.accent }]} />
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>
      <Button
        label={best === undefined ? "Not ready yet" : "Open the 3D model"}
        icon="cube"
        kind="primary"
        disabled={best === undefined}
        onPress={() => props.navigation.navigate("GooViewer", { relayBase: props.relayBase, taskId: props.taskId, name: props.filename })}
      />
    </Card>
  );
};

const styles = StyleSheet.create({
  body: { flexDirection: "row", gap: 14, marginBottom: 14 },
  thumb: { width: 72, height: 72, borderRadius: 14, backgroundColor: "#050508" },
  rows: { flex: 1, gap: 10 },
  row: { gap: 2 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  label: { fontSize: 15, fontWeight: "600" },
  percent: { fontSize: 13, fontVariant: ["tabular-nums"] },
  detail: { fontSize: 13 },
  track: { height: 4, borderRadius: 2, overflow: "hidden", marginTop: 4 },
  fill: { height: 4, borderRadius: 2 },
});
