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
 * running past either end fade out into it: a gradient mask on that end,
 * shown only while crumbs are hidden past it (from the scroll's own numbers,
 * on the UI thread), so crumbs that fit are never faded.
 *
 * The path is there on the first frame; the scopes come once the file is
 * parsed and the editor says where you are. As they change they roll, the
 * glass turning like a drum the way the line moved (crumbRoll.ts); the others
 * slide to make room.
 *
 * Tapped, it drops below the top buttons and widens to the bar's full width
 * (the room for more crumbs, and what comes under them), and back. It sits in
 * its slot by plain layout; the slot's place, read as it is laid out, is only
 * where the drop starts from, so nothing waits on a measurement.
 *
 * @internal
 */
import MaskedView from "@react-native-masked-view/masked-view";
import { GlassView } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import * as React from "react";
import { StyleSheet, Text, useColorScheme, View, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, { Easing, interpolate, LinearTransition, runOnJS, type SharedValue, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Codicon } from "../Codicon";
import { iconForFile } from "../fileIcon";
import { HOME_HEADER_HEIGHT } from "../homeHeader";
import { SetiIcon } from "../SetiIcon";
import { useTextColors } from "../theme";
import { useCodeTheme } from "../useCodeTheme";
import type { ScopeSymbol } from "./stickyRanges";
import { type RollDirection, rollIn, rollOut } from "./crumbRoll";
import { crumbColorOf, symbolLookOf } from "./symbolLooks";

/** Room between the crumbs and the pill's ends. */
const PAD_H = 22;
/** How far crumbs fade as they run past an end. */
const FADE_W = 40;
const TEXT_SIZE = 15;
const ICON_SIZE = 16;
const CHEVRON_SIZE = 14;
/** How long the others (and the row) take to make room for a scope that
 * changed. */
const crumbMove = LinearTransition.duration(220);
/** How far below the top buttons it drops, and how long it takes. */
const DROP_GAP = 8;
const DROP = { duration: 320, easing: Easing.out(Easing.cubic) };

export const BreadcrumbPill = (props: {
  readonly path: ReadonlyArray<string>;
  readonly symbols: ReadonlyArray<ScopeSymbol>;
  /** Which way the scopes roll as they change. */
  readonly roll: SharedValue<RollDirection>;
  /** Dropped below the top buttons, at the bar's full width. */
  readonly expanded: boolean;
  readonly onToggle: () => void;
  /** The bar's width, what it widens to. */
  readonly expandedWidth: number;
  /** Its slot in the bar. */
  readonly slotStyle: ViewStyle;
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

  // Where its slot is in the bar (from the slot's own layout), for the drop
  // to start from; at rest it simply fills the slot.
  const slotX = useSharedValue(0);
  const slotW = useSharedValue(0);
  const open = useSharedValue(props.expanded ? 1 : 0);
  const { expanded, expandedWidth } = props;
  // While it drops or rises, the row's own slide is off: the row is resized
  // every frame, and would chase it.
  const [dropping, setDropping] = React.useState(false);
  const isFirst = React.useRef(true);
  React.useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    setDropping(true);
    open.value = withTiming(expanded ? 1 : 0, DROP, (finished) => {
      if (finished === true) runOnJS(setDropping)(false);
    });
  }, [expanded, open]);
  const frame = useAnimatedStyle(() => {
    const progress = open.value;
    if (progress === 0 || slotW.value === 0) return { left: 0, top: 0, width: "100%" };
    return {
      left: -slotX.value * progress,
      top: (HOME_HEADER_HEIGHT + DROP_GAP) * progress,
      width: slotW.value + (expandedWidth - slotW.value) * progress,
    };
  });
  const { onToggle } = props;
  const tap = React.useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .onEnd((_event, success) => {
          if (success) onToggle();
        }),
    [onToggle],
  );

  // How much of the crumbs is hidden past each end: the scroll view's start
  // is the right end (mirrored), so what it has scrolled is hidden on the
  // right and the rest of what overflows on the left. An end fades only as
  // far as crumbs are hidden past it.
  const offset = useSharedValue(0);
  const content = useSharedValue(0);
  const viewport = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    offset.value = event.contentOffset.x;
    content.value = event.contentSize.width;
    viewport.value = event.layoutMeasurement.width;
  });
  const leftSolid = useAnimatedStyle(() => ({ opacity: interpolate(content.value - viewport.value - offset.value, [0, FADE_W], [1, 0], "clamp") }));
  const rightSolid = useAnimatedStyle(() => ({ opacity: interpolate(offset.value, [0, FADE_W], [1, 0], "clamp") }));

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
    <View
      // The bar's height: the pill floats in it (to drop out of it), so it
      // gives the slot no height of its own.
      style={[props.slotStyle, styles.slot]}
      onLayout={(event) => {
        slotX.value = event.nativeEvent.layout.x;
        slotW.value = event.nativeEvent.layout.width;
      }}
    >
      <GestureDetector gesture={tap}>
        <Reanimated.View style={[styles.shadow, frame]} accessibilityRole="button" accessibilityLabel={[...props.path, ...props.symbols.map((symbol) => symbol.name)].join(", ")}>
          <View style={styles.clip}>
            <GlassView style={StyleSheet.absoluteFill} glassEffectStyle="regular" colorScheme={scheme} />
            <MaskedView
              style={styles.fill}
              maskElement={
                <View style={maskStyles.mask}>
                  <View style={maskStyles.edge}>
                    <LinearGradient colors={FADE_IN} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                    <Reanimated.View style={[maskStyles.solid, leftSolid]} />
                  </View>
                  <View style={maskStyles.middle} />
                  <View style={maskStyles.edge}>
                    <LinearGradient colors={FADE_OUT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                    <Reanimated.View style={[maskStyles.solid, rightSolid]} />
                  </View>
                </View>
              }
            >
              <Reanimated.ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.mirrored}
                contentContainerStyle={styles.content}
                onScroll={onScroll}
                scrollEventThrottle={16}
                onLayout={(event) => {
                  viewport.value = event.nativeEvent.layout.width;
                }}
                onContentSizeChange={(width) => {
                  content.value = width;
                }}
              >
                {/* Its size eases to the new one, so the crumbs before a scope
                  * that changed width slide over rather than jump. */}
                <Reanimated.View style={[styles.row, styles.mirrored]} layout={dropping ? undefined : crumbMove}>
                  {pathCrumbs}
                  {symbolCrumbs}
                </Reanimated.View>
              </Reanimated.ScrollView>
            </MaskedView>
          </View>
        </Reanimated.View>
      </GestureDetector>
    </View>
  );
};

const maskStyles = StyleSheet.create({
  mask: {
    ...StyleSheet.absoluteFill,
    flexDirection: "row",
  },
  edge: {
    width: FADE_W,
  },
  middle: {
    flex: 1,
    backgroundColor: "#000000",
  },
  // Over an end's gradient: shows the crumbs whole there while none are
  // hidden past it.
  solid: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "#000000",
  },
});

/** Clear at the outer edge to opaque: the fade at each end. */
const FADE_IN: readonly [string, string] = ["#00000000", "#000000"];
const FADE_OUT: readonly [string, string] = ["#000000", "#00000000"];

const styles = StyleSheet.create({
  slot: {
    height: HOME_HEADER_HEIGHT,
  },
  fill: {
    flex: 1,
  },
  shadow: {
    position: "absolute",
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
