/**
 * The floating glass search pill that rides the bottom edge, gets out of the way
 * as you scroll down (like Files and Mail move their toolbars), and rides above
 * the keyboard when the field is focused.
 *
 * Two pieces: `useSearchPill` owns the scroll behaviour and hands back an
 * `onScroll` for the list plus a reanimated `hidden` shared value; and
 * `BottomSearchPill` renders the pill, combining that with live keyboard
 * tracking into a single animated `bottom`.
 *
 * Everything vertical is driven through `bottom` on ONE reanimated view — no
 * `transform`. A transform composites the pill into its own layer, under which
 * the `SystemIcon` `Host` mis-measured on first mount (the search glyph drifting
 * off-centre until an app background/foreground re-initialised it). Animating
 * `bottom` keeps the glyph in normal layout flow. It's all reanimated (UI
 * thread), so the keyboard track stays exact and the scroll-hide stays smooth.
 *
 * @internal
 */
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { StyleSheet, TextInput, useColorScheme, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import Reanimated, {
  Easing,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AgentButton } from "./AgentButton";
import { useAgentButtonVisible, type AgentSurface } from "./agentButtonSettings";
import { colors } from "./colors";
import { COMPOSER_PILL_HEIGHT } from "./composerBarSpec";

/** Height of the pill. Callers add it to their list's bottom inset.
 * Matched to the main composer pill's collapsed height (shared constant). */
export const SEARCH_PILL_HEIGHT = COMPOSER_PILL_HEIGHT;

/** How far past the bottom edge the pill travels when it hides. */
const hiddenDistanceFor = (bottomInset: number): number => SEARCH_PILL_HEIGHT + bottomInset + 18;

/** Ignore scroll jitter below this many points, so the pill does not flicker. */
const DIRECTION_THRESHOLD = 6;
/** Within this far of the top the pill is always shown. */
const TOP_ZONE = 4;

export interface SearchPillScroll {
  /** Hand to the scrolling list's `onScroll`. */
  readonly onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** How far the pill is pushed below its resting position (0 = shown); pass to `BottomSearchPill`. */
  readonly hidden: SharedValue<number>;
  /** Bottom padding a list needs so its last row clears the pill. */
  readonly listPaddingBottom: number;
}

/**
 * UIKit has no hook for a custom bottom bar, so the reveal is driven from the
 * scroll direction here into a reanimated shared value, animated on the UI
 * thread so it stays smooth while the list is still settling.
 */
export const useSearchPill = (): SearchPillScroll => {
  const insets = useSafeAreaInsets();
  const hidden = useSharedValue(0);
  const lastY = React.useRef(0);
  const isHidden = React.useRef(false);
  const hiddenDistance = hiddenDistanceFor(insets.bottom);

  const setHidden = React.useCallback(
    (next: boolean): void => {
      if (isHidden.current === next) return;
      isHidden.current = next;
      // Curved, not linear: accelerate away on hide, ease back a touch slower.
      hidden.value = withTiming(next ? hiddenDistance : 0, {
        duration: next ? 200 : 320,
        easing: next ? Easing.in(Easing.cubic) : Easing.out(Easing.cubic),
      });
    },
    [hidden, hiddenDistance],
  );

  const onScroll = React.useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
      const y = event.nativeEvent.contentOffset.y;
      const dy = y - lastY.current;
      if (y <= TOP_ZONE) setHidden(false);
      else if (dy > DIRECTION_THRESHOLD) setHidden(true);
      else if (dy < -DIRECTION_THRESHOLD) setHidden(false);
      lastY.current = y;
    },
    [setHidden],
  );

  return {
    onScroll,
    hidden,
    listPaddingBottom: insets.bottom + SEARCH_PILL_HEIGHT + 28,
  };
};

export const BottomSearchPill = (props: {
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder: string;
  readonly hidden: SharedValue<number>;
  /** Which surface this is, gating the assistant button per the user's settings. */
  readonly agentSurface: AgentSurface;
  /** Opens the app-wide assistant; wired later, so optional. */
  readonly onAgent?: () => void;
}): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const keyboard = useAnimatedKeyboard();
  const showAgent = useAgentButtonVisible(props.agentSurface);

  // One animated `bottom`: rest at the safe-area inset, rise with the keyboard
  // (exact, UI thread), and drop by the scroll-hide amount. No transform, so the
  // SystemIcon Host inside never mis-measures.
  const restingBottom = insets.bottom;
  const hiddenValue = props.hidden;
  const animatedStyle = useAnimatedStyle(() => ({
    bottom: Math.max(keyboard.height.value, restingBottom) - hiddenValue.value,
  }));

  return (
    <Reanimated.View style={[styles.wrap, { paddingBottom: 10 }, animatedStyle]} pointerEvents="box-none">
      {/* Pill + the assistant button on the right, matching the composer. */}
      <View style={styles.row}>
        {/* The squircle clip lives on this plain View, never on `GlassView`:
         * setting `borderCurve` on the glass itself breaks the effect outright
         * (see the SessionComposer handoff's invariant 2). */}
        <View style={styles.clip}>
          <GlassView style={styles.pill} glassEffectStyle="regular" colorScheme={scheme === "dark" ? "dark" : "light"}>
            {/* A plain Feather glyph, not the @expo/ui SystemIcon (a Host): the
             * Host's measurement race (see SystemIcon's own doc) drifted the
             * glyph off-centre on first mount here, fixing only on
             * background/foreground. A vector icon flex-centres reliably and
             * still takes the adaptive PlatformColor. */}
            <Feather name="search" size={16} color={colors.secondaryLabel} />
            <TextInput
              style={styles.input}
              value={props.value}
              onChangeText={props.onChangeText}
              placeholder={props.placeholder}
              placeholderTextColor={colors.placeholderText}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
            />
          </GlassView>
        </View>
        {showAgent ? <AgentButton onPress={props.onAgent} /> : null}
      </View>
    </Reanimated.View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
  },
  // Pill + assistant button on one row, button vertically centred with the pill.
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  clip: {
    // Flex so the pill fills the row and the assistant button sits at the edge.
    flex: 1,
    borderRadius: SEARCH_PILL_HEIGHT / 2,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: SEARCH_PILL_HEIGHT,
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    color: colors.label,
    fontSize: 16,
    padding: 0,
  },
});
