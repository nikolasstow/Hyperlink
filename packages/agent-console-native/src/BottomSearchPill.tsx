/**
 * The floating glass search pill that rides the bottom edge and gets out of the
 * way as you scroll down, the way Files and Mail move their toolbars.
 *
 * Extracted from `FileExplorerScreen`, which built it first and still uses it.
 * A shared helper is earned once the shape has provably repeated
 * (`principles.dont-reinvent-dont-preabstract`); the theme editor is the second
 * use, so this is the moment to lift it rather than copy it.
 *
 * Two pieces, because screens need them at different points in their tree:
 * `useSearchPill` owns the scroll behaviour and hands back an `onScroll` for
 * the list plus the transform for the pill, and `BottomSearchPill` renders the
 * pill itself.
 *
 * @internal
 */
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import {
  Animated,
  Easing,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AgentButton } from "./AgentButton";
import { useAgentButtonVisible, type AgentSurface } from "./agentButtonSettings";
import { colors } from "./colors";
import { SystemIcon } from "./SystemIcon";
import { useKeyboardOffset } from "./useKeyboardOffset";

/** Height of the pill. Callers add it to their list's bottom inset. */
export const SEARCH_PILL_HEIGHT = 44;

/** How far past the bottom edge the pill travels when it hides. */
const hiddenDistanceFor = (bottomInset: number): number => SEARCH_PILL_HEIGHT + bottomInset + 18;

/** Ignore scroll jitter below this many points, so the pill does not flicker. */
const DIRECTION_THRESHOLD = 6;
/** Within this far of the top the pill is always shown. */
const TOP_ZONE = 4;

export interface SearchPillScroll {
  /** Hand to the scrolling list's `onScroll`. */
  readonly onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** The pill's vertical offset; pass to `BottomSearchPill`. */
  readonly offset: Animated.Value;
  /** Bottom padding a list needs so its last row clears the pill. */
  readonly listPaddingBottom: number;
}

/**
 * UIKit has no hook for a custom bottom bar, so the reveal is driven from the
 * scroll direction here. The offset animates on the native driver, which keeps
 * it smooth while the list is still settling.
 */
export const useSearchPill = (): SearchPillScroll => {
  const insets = useSafeAreaInsets();
  const offset = React.useRef(new Animated.Value(0)).current;
  const lastY = React.useRef(0);
  const hidden = React.useRef(false);
  const hiddenDistance = hiddenDistanceFor(insets.bottom);

  const setHidden = React.useCallback(
    (next: boolean): void => {
      if (hidden.current === next) return;
      hidden.current = next;
      Animated.timing(offset, {
        toValue: next ? hiddenDistance : 0,
        // Curved, not linear: accelerate away on hide, ease back into place a
        // touch slower on reveal.
        duration: next ? 200 : 320,
        easing: next ? Easing.in(Easing.cubic) : Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    },
    [offset, hiddenDistance],
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
    offset,
    listPaddingBottom: insets.bottom + SEARCH_PILL_HEIGHT + 28,
  };
};

export const BottomSearchPill = (props: {
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder: string;
  readonly offset: Animated.Value;
  /** Which surface this is, gating the assistant button per the user's settings. */
  readonly agentSurface: AgentSurface;
  /** Opens the app-wide assistant; wired later, so optional. */
  readonly onAgent?: () => void;
}): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  // Ride above the keyboard instead of hiding behind it — an animated bottom
  // offset that rests at the safe-area inset and tracks the keyboard up/down
  // (so the pad below stays constant at 10).
  const bottomOffset = useKeyboardOffset(insets.bottom);
  const showAgent = useAgentButtonVisible(props.agentSurface);

  return (
    <Animated.View
      style={[styles.wrap, { bottom: bottomOffset, paddingBottom: 10, transform: [{ translateY: props.offset }] }]}
      pointerEvents="box-none"
    >
      {/* Pill + the assistant button on the right, matching the composer. */}
      <View style={styles.row}>
        {/* The squircle clip lives on this plain View, never on `GlassView`:
         * setting `borderCurve` on the glass itself breaks the effect outright
         * (see the SessionComposer handoff's invariant 2). */}
        <View style={styles.clip}>
          <GlassView style={styles.pill} glassEffectStyle="regular" colorScheme={scheme === "dark" ? "dark" : "light"}>
            <SystemIcon name="magnifyingglass" size={16} color={colors.secondaryLabel} />
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
    </Animated.View>
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
