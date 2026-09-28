/**
 * Skeletons: the shape of a page drawn in soft gray while it has nothing to
 * show yet, in place of a spinner. They pulse gently so the wait reads as
 * loading, and are only for a first load: a page with anything cached shows
 * that instead.
 *
 * - `SkeletonPage`: a page of cards (the NPM page): a few rows, a section, a
 *   grid.
 * - `SkeletonList`: full-width rows with an icon and two lines (a tree view,
 *   a collection's list).
 * - `SkeletonGrid`: two-column tiles (a collection's grid).
 *
 * @internal
 */
import * as React from "react";
import { Animated, Easing, StyleSheet, View, type DimensionValue } from "react-native";
import { colors } from "./colors";

/** One pulse, shared by every bone on screen so they breathe together. */
const usePulse = (): Animated.Value => {
  const pulse = React.useRef(new Animated.Value(0.5)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return pulse;
};

const Bone = (props: { readonly width: DimensionValue; readonly height: number; readonly radius?: number }): React.ReactElement => (
  <View style={[styles.bone, { width: props.width, height: props.height, borderRadius: props.radius ?? 6 }]} />
);

/** A card of label and value rows. */
const CardRows = (props: { readonly rows: number }): React.ReactElement => (
  <View style={styles.card}>
    {Array.from({ length: props.rows }, (_, index) => (
      <View key={index} style={[styles.row, index > 0 && styles.rowBorder]}>
        <Bone width="30%" height={14} />
        <Bone width="25%" height={14} />
      </View>
    ))}
  </View>
);

export const SkeletonPage = (props: { readonly top: number }): React.ReactElement => {
  const pulse = usePulse();
  return (
    <Animated.View style={[styles.page, { paddingTop: props.top + 16, opacity: pulse }]}>
      <CardRows rows={3} />
      <View style={styles.label}>
        <Bone width={90} height={11} />
      </View>
      <CardRows rows={3} />
      <View style={styles.label}>
        <Bone width={110} height={11} />
      </View>
      <View style={styles.grid}>
        {Array.from({ length: 4 }, (_, index) => (
          <View key={index} style={styles.tile}>
            <Bone width="70%" height={14} />
            <Bone width="45%" height={11} />
          </View>
        ))}
      </View>
    </Animated.View>
  );
};

export const SkeletonList = (props: { readonly top: number; readonly rows?: number }): React.ReactElement => {
  const pulse = usePulse();
  return (
    <Animated.View style={{ paddingTop: props.top + 8, opacity: pulse }}>
      {Array.from({ length: props.rows ?? 10 }, (_, index) => (
        <View key={index} style={[styles.listRow, index > 0 && styles.rowBorder]}>
          <Bone width={22} height={22} radius={5} />
          <View style={styles.lines}>
            <Bone width={`${55 - (index % 3) * 10}%`} height={14} />
            <Bone width={`${35 - (index % 2) * 10}%`} height={11} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
};

export const SkeletonGrid = (props: { readonly top: number; readonly tiles?: number }): React.ReactElement => {
  const pulse = usePulse();
  return (
    <Animated.View style={[styles.page, { paddingTop: props.top + 16, opacity: pulse }]}>
      <View style={styles.grid}>
        {Array.from({ length: props.tiles ?? 8 }, (_, index) => (
          <View key={index} style={styles.tile}>
            <Bone width="70%" height={14} />
            <Bone width="45%" height={11} />
          </View>
        ))}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  bone: {
    backgroundColor: colors.fillBackground,
  },
  page: {
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: 14,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 15,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  label: {
    marginTop: 26,
    marginBottom: 8,
    marginLeft: 4,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  tile: {
    width: "48%",
    flexGrow: 1,
    height: 72,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.cardBackground,
    justifyContent: "space-between",
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.systemBackground,
  },
  lines: {
    flex: 1,
    gap: 6,
  },
});
