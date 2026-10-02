/**
 * The app's bottom bar as a compositional shell: it owns the hard, load-bearing
 * parts once — the glass field, the squircle clip, the collapse layout — and
 * takes the variable parts as
 * **slots** rather than as a pile of variant params. A variant (the chat/Home
 * `Composer`) supplies its `input`, `leading`, centre and
 * `trailing` elements and drives the shell with a single `expanded` flag.
 *
 * Why a presentational shell driven by `expanded`, not a context that owns the
 * state: the state that makes this bar work (focus → animate → collapse, text →
 * armed send, send → clear) is intricate and timing-sensitive, and it lives in
 * the variant unchanged. The shell only *lays out* what it's given and gates
 * visibility by `expanded`. That keeps every invariant from the composer
 * handoff intact **by construction**:
 *
 * - Nothing here unmounts across the collapse cycle — `GlassView`, the `input`
 *   slot, both centre slots and `trailing` all stay mounted; collapse is
 *   height/width/opacity, never conditional rendering. (The one `expandHit`
 *   Pressable is a plain toggle, not part of the glass/Host first-mount
 *   hazard.)
 * - The glass is rounded by `borderRadius` on the `GlassView` itself (native
 *   UIGlassEffect corner configuration), never clipped by a rounded
 *   `overflow: hidden` parent: that crops iOS's glass to a hard shape and it
 *   falls back to a flat look (Dubz.tsx has the rules). No `borderCurve` on the
 *   glass either; that broke it outright.
 * - Expanding and collapsing animate on the UI thread from the variant's
 *   `geometry` (barGeometry.ts): the section heights and the controls' gap are
 *   `open` × a known height, so whatever reserves room for the bar reads the
 *   same values in the same frame. Layout, never a transform or opacity on the
 *   glass.
 *
 * @internal
 */
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";
import Reanimated, { useAnimatedStyle } from "react-native-reanimated";
import { type BarGeometry, CONTROLS_GAP } from "./barGeometry";
import { colors } from "./colors";
import { COMPOSER_CHIP_SIZE, COMPOSER_FIELD_PADDING, COMPOSER_SEND_CHIP_SIZE } from "./composerBarSpec";

// Comfortably under half the field's smallest (idle) rendered height, so the
// rounded corners never overlap/distort no matter which row arrangement shows.
const FIELD_RADIUS = 30;
/** A light wash in the clear glass, so the bar reads over busy content. */
const FIELD_TINT_LIGHT = "rgba(255,255,255,0.3)";
const FIELD_TINT_DARK = "rgba(0,0,0,0.3)";

export interface BottomBarProps {
  /** Focused or non-empty — the variant computes it; gates touches. */
  readonly expanded: boolean;
  /** The animated heights the bar lays out by (the variant drives them). */
  readonly geometry: BarGeometry;
  /** Home-indicator safe-area inset (0 when the keyboard covers it). */
  readonly bottomInset: number;
  /** An error line above the bar, or nothing. */
  readonly error?: string;
  /** Extra content inside the bubble above the input (Home's pickers), at a
   * set height; collapses with the input. Omit for chat. */
  readonly topSection?: BarTopSection;
  /** The growing input element (a `TextInput` as tall as `geometry.input`);
   * the shell collapses its section. */
  readonly input: React.ReactNode;
  /** Left control, always visible (the `+` chip). */
  readonly leading: React.ReactNode;
  /** Centre content shown while expanded (the model picker). */
  readonly expandedCenter: React.ReactNode;
  /** Centre content shown while collapsed (the one-line mirror of the input). */
  readonly collapsedCenter: React.ReactNode;
  /** Right control (Send), always shown: muted while there is nothing to send. */
  readonly trailing: React.ReactNode;
  /** Open the bar — bound to taps on the collapsed pill / mirror. */
  readonly onExpandRequest: () => void;
}

export interface BarTopSection {
  readonly node: React.ReactNode;
  readonly height: number;
}

export const BottomBar = (props: BottomBarProps): React.ReactElement => {
  const scheme = useColorScheme();
  const { expanded, geometry } = props;
  const topHeight = props.topSection?.height ?? 0;
  const topStyle = useAnimatedStyle(() => ({
    height: geometry.open.value * topHeight,
    opacity: geometry.open.value,
  }));
  const inputStyle = useAnimatedStyle(() => ({
    height: geometry.open.value * geometry.input.value,
    opacity: geometry.open.value,
  }));
  const controlsStyle = useAnimatedStyle(() => ({
    paddingTop: geometry.open.value * CONTROLS_GAP,
  }));

  return (
    <View style={[styles.root, { paddingBottom: Math.max(props.bottomInset, 8) }]}>
      {props.error !== undefined ? (
        <Text style={styles.error} numberOfLines={1}>
          {props.error}
        </Text>
      ) : null}
      {/* The small drop shadow lives on this OUTER wrapper; it does not clip or
       * round the glass (the glass rounds itself). */}
      <View style={styles.pillShadow}>
        <GlassView style={styles.field} glassEffectStyle="clear" tintColor={scheme === "dark" ? FIELD_TINT_DARK : FIELD_TINT_LIGHT} colorScheme={scheme === "dark" ? "dark" : "light"}>
          {props.topSection !== undefined ? (
            <Reanimated.View style={[styles.section, topStyle]} pointerEvents={expanded ? "auto" : "none"}>
              {props.topSection.node}
            </Reanimated.View>
          ) : null}
          {/* The input alone, grows upward, collapses to 0 height + 0 opacity
           * when idle; never unmounts. */}
          <Reanimated.View style={[styles.section, inputStyle]} pointerEvents={expanded ? "auto" : "none"}>
            {props.input}
          </Reanimated.View>
          {/* controlsRow — always visible: leading | centre | trailing. */}
          <Reanimated.View style={[styles.controlsRow, controlsStyle]}>
            {props.leading}
            {/* Two always-mounted, absolutely-stacked centre slots, cross-faded
             * by opacity/pointerEvents on `expanded` — never conditionally
             * rendered, which is what removes the icon-settles-late race. */}
            <View style={styles.pickerSlot}>
              <View style={[styles.slotContent, styles.autoContent, { opacity: expanded ? 1 : 0 }]} pointerEvents={expanded ? "auto" : "none"}>
                {props.expandedCenter}
              </View>
              <Pressable style={[styles.slotContent, { opacity: expanded ? 0 : 1 }]} pointerEvents={expanded ? "none" : "auto"} onPress={props.onExpandRequest}>
                {props.collapsedCenter}
              </Pressable>
            </View>
            {/* Send: always shown, as before Dubz; collapsed, a tap on it
             * opens the bar (the variant's handler). */}
            <View style={styles.sendSlot}>
              {props.trailing}
            </View>
          </Reanimated.View>
          {/* Collapsed: catch taps anywhere the buttons don't claim so the
           * whole pill expands. Expanded: gone, so the controls work normally. */}
          {!expanded ? (
            <Pressable style={styles.expandHit} onPress={props.onExpandRequest} accessibilityRole="button" />
          ) : null}
        </GlassView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    // The Dubz window's margin, so the two pages line up side by side.
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  // One line at a set height (ERROR_LINE_HEIGHT), so the room it takes is known.
  error: {
    color: colors.destructive,
    fontSize: 13,
    lineHeight: 16,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  // Carries the pill's flex and its small drop shadow (no overflow, so the
  // shadow isn't clipped); the rounded rect gives the shadow its shape.
  pillShadow: {
    borderRadius: FIELD_RADIUS,
    borderCurve: "continuous",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1.5 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  field: {
    padding: COMPOSER_FIELD_PADDING,
    position: "relative",
    borderRadius: FIELD_RADIUS,
  },
  expandHit: {
    ...StyleSheet.absoluteFill,
  },
  section: {
    overflow: "hidden",
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pickerSlot: {
    flex: 1,
    height: COMPOSER_CHIP_SIZE,
    position: "relative",
  },
  slotContent: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  autoContent: {
    gap: 4,
  },
  sendSlot: {
    width: COMPOSER_SEND_CHIP_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
});
