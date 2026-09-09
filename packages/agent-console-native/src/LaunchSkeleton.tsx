/**
 * The launch loading view: the Home skeleton PLUS real glass chrome — the header
 * buttons and the composer — so the launch looks like Home with its content
 * still filling in, not a bare fragment.
 *
 * Everything here is rendered directly (no navigation, no Home mount, no client),
 * so it can't hit the blank that mounting Home early caused. The glass is real
 * `GlassView` (confirmed to render on the launch view); the header buttons carry
 * the same SF Symbols Home's nav items use.
 *
 * Chrome is solid (present UI); only the cards pulse (content loading).
 *
 * @internal
 */
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "./colors";
import { HomeSkeleton } from "./HomeSkeleton";
import { SystemIcon } from "./SystemIcon";
import type { SFSymbol } from "sf-symbols-typescript";

/** A glass circle button carrying one SF Symbol — mirrors Home's nav items. */
const HeaderButton = (props: { readonly name: SFSymbol }): React.ReactElement => (
  <GlassView style={styles.circle}>
    <SystemIcon name={props.name} size={20} color={colors.label} />
  </GlassView>
);

export const LaunchSkeleton = (): React.ReactElement => {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      {/* Header: Settings on the left; Search + New on the right — Home's items. */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <HeaderButton name="gearshape" />
        <View style={styles.spacer} />
        <HeaderButton name="magnifyingglass" />
        <HeaderButton name="folder.badge.plus" />
      </View>

      <View style={styles.body}>
        <HomeSkeleton />
      </View>

      {/* Composer look-alike: a glass bar with Home's prompt. */}
      <GlassView style={[styles.composer, { marginBottom: insets.bottom + 8 }]}>
        <Text style={styles.composerText}>Plan, ask, build…</Text>
      </GlassView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  spacer: {
    flex: 1,
  },
  circle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    flex: 1,
  },
  composer: {
    marginHorizontal: 12,
    minHeight: 52,
    borderRadius: 26,
    overflow: "hidden",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  composerText: {
    color: colors.placeholderText,
    fontSize: 17,
  },
});
