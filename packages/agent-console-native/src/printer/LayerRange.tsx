/**
 * Two grabbers on a vertical track that pick a range of layers, for the 3D
 * view's crop: the bottom of the track is layer 1, the top is the last layer.
 * Each grabber shows its layer while it moves. The grabbers never cross.
 *
 * @internal
 */
import * as React from "react";
import { PanResponder, StyleSheet, Text, View, type ColorValue, type LayoutChangeEvent } from "react-native";
import { withAlpha } from "../theme";

/** A layer range, 1 to the layer count, `from` at or below `to`. */
export interface Range {
  readonly from: number;
  readonly to: number;
}

const THUMB = 30;

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

export const LayerRange = (props: {
  readonly count: number;
  readonly range: Range;
  readonly onChange: (range: Range) => void;
  readonly color: string;
  readonly labelColor: ColorValue;
}): React.ReactElement => {
  const { count } = props;
  const [height, setHeight] = React.useState(0);
  const [moving, setMoving] = React.useState<"from" | "to" | undefined>(undefined);
  // The latest values for the pan handlers, which are made once.
  const latest = React.useRef({ range: props.range, height, count, onChange: props.onChange });
  latest.current = { range: props.range, height, count, onChange: props.onChange };

  // Track position (0 at the top) of a layer, and back.
  const yOf = (layer: number): number => (height <= 0 || count <= 1 ? 0 : (1 - (layer - 1) / (count - 1)) * height);
  const layerAt = (y: number, track: number, layers: number): number => Math.round(1 + (1 - clamp(y, 0, track) / Math.max(1, track)) * (layers - 1));

  const responder = (which: "from" | "to") => {
    let startY = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const { range, height: track, count: layers } = latest.current;
        startY = track <= 0 || layers <= 1 ? 0 : (1 - ((which === "from" ? range.from : range.to) - 1) / (layers - 1)) * track;
        setMoving(which);
      },
      onPanResponderMove: (_, gesture) => {
        const { range, height: track, count: layers, onChange } = latest.current;
        const layer = layerAt(startY + gesture.dy, track, layers);
        onChange(which === "from" ? { from: Math.min(layer, range.to), to: range.to } : { from: range.from, to: Math.max(layer, range.from) });
      },
      onPanResponderRelease: () => setMoving(undefined),
      onPanResponderTerminate: () => setMoving(undefined),
    });
  };
  const fromPan = React.useRef(responder("from")).current;
  const toPan = React.useRef(responder("to")).current;

  const top = yOf(props.range.to);
  const bottom = yOf(props.range.from);
  const thumb = (which: "from" | "to", y: number): React.ReactElement => (
    <View
      {...(which === "from" ? fromPan.panHandlers : toPan.panHandlers)}
      style={[styles.thumb, { top: y - THUMB / 2, backgroundColor: props.color, borderColor: withAlpha("#FFFFFF", 0.9) }]}
      hitSlop={14}
      accessibilityRole="adjustable"
      accessibilityLabel={which === "from" ? "Lowest layer" : "Highest layer"}
      accessibilityValue={{ text: `Layer ${(which === "from" ? props.range.from : props.range.to).toLocaleString()}` }}
    >
      {moving === which || moving === undefined ? (
        <Text style={[styles.label, { color: props.labelColor }]} numberOfLines={1}>
          {(which === "from" ? props.range.from : props.range.to).toLocaleString()}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={styles.track} onLayout={(event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height)}>
      <View style={[styles.rail, { backgroundColor: withAlpha("#FFFFFF", 0.25) }]} />
      <View style={[styles.fill, { top, height: Math.max(0, bottom - top), backgroundColor: props.color }]} />
      {height > 0 ? (
        <>
          {thumb("to", top)}
          {thumb("from", bottom)}
        </>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  track: { width: THUMB, flex: 1, alignItems: "center" },
  rail: { position: "absolute", top: 0, bottom: 0, width: 4, borderRadius: 2 },
  fill: { position: "absolute", width: 4, borderRadius: 2 },
  thumb: { position: "absolute", width: THUMB, height: THUMB, borderRadius: THUMB / 2, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  label: { position: "absolute", right: THUMB + 8, fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"], minWidth: 60, textAlign: "right" },
});
