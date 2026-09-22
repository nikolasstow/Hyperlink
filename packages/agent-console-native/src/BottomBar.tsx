/**
 * The app's bottom bar as a compositional shell: it owns the hard, load-bearing
 * parts once — the glass field, the squircle clip, the collapse layout, and the
 * app-wide assistant (Dubz) accessory — and takes the variable parts as
 * **slots** rather than as a pile of variant params. A variant (the chat/Home
 * `Composer` today; search later) supplies its `input`, `leading`, centre and
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
 *   slot, both centre slots, `trailing` and the assistant all stay mounted;
 *   collapse is height/width/opacity, never conditional rendering. (The one
 *   `expandHit` Pressable and the settings-gated assistant are plain toggles,
 *   not part of the glass/Host first-mount hazard.)
 * - The squircle clip is on the plain wrapping `fieldClip` View, never on
 *   `GlassView` (its own `setBorderCurve` broke the effect).
 * - The expand/collapse animation is the variant's to trigger
 *   (`LayoutAnimation.configureNext` in its focus/blur/send handlers); the
 *   layout change it animates lives here, driven by the `expanded` prop.
 *
 * @internal
 */
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";
import { AgentButton } from "./AgentButton";
import { useAgentButtonVisible, type AgentSurface } from "./agentButtonSettings";
import { colors } from "./colors";
import { COMPOSER_CHIP_SIZE, COMPOSER_SEND_CHIP_SIZE } from "./composerBarSpec";

// Comfortably under half the field's smallest (idle) rendered height, so the
// rounded corners never overlap/distort no matter which row arrangement shows.
const FIELD_RADIUS = 30;

export interface BottomBarProps {
  /** Focused or non-empty — the variant computes it and owns the animation. */
  readonly expanded: boolean;
  /** Home-indicator safe-area inset (0 when the keyboard covers it). */
  readonly bottomInset: number;
  /** An error line above the bar, or nothing. */
  readonly error?: string;
  /** Extra content inside the bubble above the input (Home's pickers); collapses
   * with the input. Omit for chat. */
  readonly topSection?: React.ReactNode;
  /** The growing input element (a `TextInput`); the shell collapses its section. */
  readonly input: React.ReactNode;
  /** Left control, always visible (the `+` chip). */
  readonly leading: React.ReactNode;
  /** Centre content shown while expanded (the model picker). */
  readonly expandedCenter: React.ReactNode;
  /** Centre content shown while collapsed (the one-line mirror of the input). */
  readonly collapsedCenter: React.ReactNode;
  /** Right control shown only while expanded (Send); slides to 0 width collapsed. */
  readonly trailing: React.ReactNode;
  /** Focus the input — bound to taps on the collapsed pill / mirror. */
  readonly onExpandRequest: () => void;
  /** Which surface this is, gating the assistant per the user's settings. */
  readonly agentSurface: AgentSurface;
  /** Opens the assistant; wired later, so optional. */
  readonly onAgent?: () => void;
}

export const BottomBar = (props: BottomBarProps): React.ReactElement => {
  const scheme = useColorScheme();
  const showAgent = useAgentButtonVisible(props.agentSurface);
  const { expanded } = props;

  return (
    <View style={[styles.root, { paddingBottom: Math.max(props.bottomInset, 8) }]}>
      {props.error !== undefined ? <Text style={styles.error}>{props.error}</Text> : null}
      {/* The pill and the assistant sit in one row: the pill flexes to fill,
       * the assistant rides its right edge. */}
      <View style={styles.barRow}>
        {/* The shadow lives on this OUTER wrapper, never on `fieldClip` — that
         * one clips (overflow: hidden) for the squircle, which would clip its
         * own shadow too. */}
        <View style={styles.pillShadow}>
        {/* The squircle clip lives on this plain wrapping View, not on GlassView
         * directly — GlassView's own setBorderCurve broke the glass effect. */}
        <View style={styles.fieldClip}>
          <GlassView style={styles.field} glassEffectStyle="regular" colorScheme={scheme === "dark" ? "dark" : "light"}>
            {props.topSection !== undefined ? (
              <View style={[styles.topSection, !expanded && styles.topSectionCollapsed]} pointerEvents={expanded ? "auto" : "none"}>
                {props.topSection}
              </View>
            ) : null}
            {/* inputSection — the input alone, grows upward, collapses to 0
             * height + 0 opacity when idle; never unmounts. */}
            <View style={[styles.inputSection, !expanded && styles.inputSectionCollapsed]} pointerEvents={expanded ? "auto" : "none"}>
              {props.input}
            </View>
            {/* controlsRow — always visible: leading | centre | trailing. */}
            <View style={[styles.controlsRow, !expanded && styles.controlsRowCollapsed]}>
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
              {/* Send: shown expanded, slides to 0 width collapsed. overflow clips
               * the still-mounted Host so nothing unmounts. */}
              <View style={[styles.sendSlot, !expanded && styles.sendSlotCollapsed]} pointerEvents={expanded ? "auto" : "none"}>
                {props.trailing}
              </View>
            </View>
            {/* Collapsed: catch taps anywhere the buttons don't claim so the
             * whole pill expands. Expanded: gone, so the controls work normally. */}
            {!expanded ? (
              <Pressable style={styles.expandHit} onPress={props.onExpandRequest} accessibilityRole="button" />
            ) : null}
          </GlassView>
        </View>
        </View>
        {showAgent ? (
          <View style={[styles.agentSlot, expanded && styles.agentSlotCollapsed]} pointerEvents={expanded ? "none" : "auto"}>
            <AgentButton onPress={props.onAgent} />
          </View>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  error: {
    color: colors.destructive,
    fontSize: 13,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  barRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  // Carries the pill's flex and its small drop shadow (no overflow, so the
  // shadow isn't clipped); the rounded rect gives the shadow its shape.
  pillShadow: {
    flex: 1,
    borderRadius: FIELD_RADIUS,
    borderCurve: "continuous",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1.5 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  fieldClip: {
    borderRadius: FIELD_RADIUS,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  field: {
    padding: 10,
    position: "relative",
  },
  expandHit: {
    ...StyleSheet.absoluteFill,
  },
  topSection: {
    overflow: "hidden",
  },
  topSectionCollapsed: {
    height: 0,
    opacity: 0,
    marginBottom: 0,
  },
  inputSection: {
    overflow: "hidden",
  },
  inputSectionCollapsed: {
    height: 0,
    opacity: 0,
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 8,
  },
  controlsRowCollapsed: {
    paddingTop: 0,
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
  sendSlotCollapsed: {
    width: 0,
    opacity: 0,
    // overflow clips the still-mounted Host down to 0 width ONLY while
    // collapsed — never when shown, where it would crop the glass button's edge
    // (the same crop the assistant button had).
    overflow: "hidden",
  },
  agentSlot: {
    width: COMPOSER_SEND_CHIP_SIZE,
    height: COMPOSER_SEND_CHIP_SIZE,
    marginLeft: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  agentSlotCollapsed: {
    width: 0,
    marginLeft: 0,
    opacity: 0,
    overflow: "hidden",
  },
});
