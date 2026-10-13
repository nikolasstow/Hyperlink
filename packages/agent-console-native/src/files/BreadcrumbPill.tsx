/**
 * The file page's top pill: where you are in the file, as VS Code's
 * breadcrumbs (breadcrumbs.ts) — the path from the worktree with the file's
 * icon, then the scopes the current line is in, each with its kind's codicon
 * in the theme's colour (symbolLooks.ts), chevrons between.
 *
 * It fills the room the top bar gives it. Longer than that, it scrolls,
 * resting at the end (where you are): the scroll view is mirrored, so its
 * start is the pill's right edge, and the row of crumbs inside it is mirrored
 * back — nothing is measured. Shorter, the crumbs sit at the left. Crumbs
 * running past either end fade out into it (a gradient mask as wide as the
 * crumbs' padding, so crumbs that fit are never faded).
 *
 * The path is there on the first frame; the scopes come once the file is
 * parsed and the editor says where you are. As they change they roll, the
 * glass turning like a drum the way the line moved (crumbRoll.ts); the others
 * slide to make room.
 *
 * @internal
 */
import MaskedView from "@react-native-masked-view/masked-view";
import { GlassView } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import * as React from "react";
import { ScrollView, StyleSheet, Text, useColorScheme, View } from "react-native";
import Reanimated, { LinearTransition, type SharedValue } from "react-native-reanimated";
import { Codicon } from "../Codicon";
import { iconForFile } from "../fileIcon";
import { HOME_HEADER_HEIGHT } from "../homeHeader";
import { SetiIcon } from "../SetiIcon";
import { useTextColors } from "../theme";
import { useCodeTheme } from "../useCodeTheme";
import type { ScopeSymbol } from "./stickyRanges";
import { type RollDirection, rollIn, rollOut } from "./crumbRoll";
import { crumbColorOf, symbolLookOf } from "./symbolLooks";

/** Room between the crumbs and the pill's ends, which is also how far the
 * crumbs fade as they run past them. */
const PAD_H = 22;
const TEXT_SIZE = 15;
const ICON_SIZE = 16;
const CHEVRON_SIZE = 14;
/** How long the others take to make room for a scope that changed. */
const crumbMove = LinearTransition.duration(220);

export const BreadcrumbPill = (props: {
  readonly path: ReadonlyArray<string>;
  readonly symbols: ReadonlyArray<ScopeSymbol>;
  /** Which way the scopes roll as they change. */
  readonly roll: SharedValue<RollDirection>;
}): React.ReactElement => {
  const textColors = useTextColors();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = useCodeTheme();
  const colors = typeof theme === "string" ? undefined : theme.colors;
  const text = crumbColorOf(colors, textColors.label);
  const last = props.path.length - 1;
  const { roll } = props;
  const crumbIn = React.useMemo(() => rollIn(roll), [roll]);
  const crumbOut = React.useMemo(() => rollOut(roll), [roll]);

  const chevron = (
    <View style={styles.chevron}>
      <Codicon name="chevron-right" size={CHEVRON_SIZE} color={text} />
    </View>
  );
  const pathCrumbs = props.path.map((name, index) => (
    <View key={`p${index}:${name}`} style={styles.crumb}>
      {index === 0 ? null : chevron}
      {index === last ? <SetiIcon glyph={iconForFile(name).glyph} size={ICON_SIZE} /> : null}
      <Text style={[styles.name, { color: text }]} numberOfLines={1}>
        {name}
      </Text>
    </View>
  ));
  const symbolCrumbs = props.symbols.map((symbol, index) => {
    const look = symbolLookOf(symbol.kind, colors, textColors.label);
    return (
      <Reanimated.View key={`s${index}:${symbol.kind}:${symbol.name}`} style={styles.crumb} entering={crumbIn} exiting={crumbOut} layout={crumbMove}>
        {chevron}
        <Codicon name={look.icon} size={ICON_SIZE} color={look.color} />
        <Text style={[styles.name, { color: text }]} numberOfLines={1}>
          {symbol.name}
        </Text>
      </Reanimated.View>
    );
  });

  return (
    <View style={styles.shadow} accessibilityRole="header" accessibilityLabel={[...props.path, ...props.symbols.map((symbol) => symbol.name)].join(", ")}>
      <View style={styles.clip}>
        <GlassView style={StyleSheet.absoluteFill} glassEffectStyle="regular" colorScheme={scheme} />
        <MaskedView style={styles.fill} maskElement={fadeMask}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.mirrored} contentContainerStyle={styles.content}>
            <View style={[styles.row, styles.mirrored]}>
              {pathCrumbs}
              {symbolCrumbs}
            </View>
          </ScrollView>
        </MaskedView>
      </View>
    </View>
  );
};

const maskStyles = StyleSheet.create({
  mask: {
    ...StyleSheet.absoluteFill,
    flexDirection: "row",
  },
  edge: {
    width: PAD_H,
  },
  middle: {
    flex: 1,
    backgroundColor: "#000000",
  },
});

/** Opaque in the middle, clear at the ends: what shows of the crumbs. */
const FADE_IN: readonly [string, string] = ["#00000000", "#000000"];
const FADE_OUT: readonly [string, string] = ["#000000", "#00000000"];
const fadeMask = (
  <View style={maskStyles.mask}>
    <LinearGradient colors={FADE_IN} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={maskStyles.edge} />
    <View style={maskStyles.middle} />
    <LinearGradient colors={FADE_OUT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={maskStyles.edge} />
  </View>
);

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  shadow: {
    flex: 1,
    height: HOME_HEADER_HEIGHT,
    borderRadius: HOME_HEADER_HEIGHT / 2,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  clip: {
    flex: 1,
    borderRadius: HOME_HEADER_HEIGHT / 2,
    overflow: "hidden",
  },
  mirrored: {
    transform: [{ scaleX: -1 }],
  },
  // The row packed at the mirrored end: the pill's left, when it is shorter.
  content: {
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: PAD_H,
  },
  crumb: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  chevron: {
    marginLeft: 1,
  },
  name: {
    fontSize: TEXT_SIZE,
    fontWeight: "500",
  },
});
