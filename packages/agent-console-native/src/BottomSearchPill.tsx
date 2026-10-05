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
import Reanimated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeyboardHeightValue } from "./keyboardHeight";
import { COMPOSER_PILL_HEIGHT } from "./composerBarSpec";
import { composerRestingBottom } from "./useKeyboardSlide";
import { type TextColors, useTextColors, useThemedStyles } from "./theme";
import { useScrollHide } from "./scrollHide";

/** Height of the pill. Callers add it to their list's bottom inset.
 * Matched to the main composer pill's collapsed height (shared constant). */
export const SEARCH_PILL_HEIGHT = COMPOSER_PILL_HEIGHT;

/** How far past the bottom edge the pill travels when it hides. */
const hiddenDistanceFor = (bottomInset: number): number => SEARCH_PILL_HEIGHT + bottomInset + 18;

export interface SearchPillScroll {
  /** Hand to the scrolling list's `onScroll`. */
  readonly onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** How far the pill is pushed below its resting position (0 = shown); pass to `BottomSearchPill`. */
  readonly hidden: SharedValue<number>;
  /** Bottom padding a list needs so its last row clears the pill. */
  readonly listPaddingBottom: number;
}

/** The pill leaves as the list scrolls down and comes back as it scrolls up
 * (scrollHide.ts). */
export const useSearchPill = (): SearchPillScroll => {
  const insets = useSafeAreaInsets();
  const { onScroll, hidden } = useScrollHide(hiddenDistanceFor(insets.bottom));
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
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const keyboardHeight = useKeyboardHeightValue();

  // One animated `bottom`: rest tucked toward the bottom edge — the SAME rest as
  // the composer (composerRestingBottom), so the search pill hugs the bottom the
  // way the composer does instead of floating higher — rise with the keyboard
  // (exact, UI thread), and drop by the scroll-hide amount. No transform.
  const restingBottom = composerRestingBottom(insets.bottom);
  const hiddenValue = props.hidden;
  const animatedStyle = useAnimatedStyle(() => ({
    bottom: Math.max(keyboardHeight.value, restingBottom) - hiddenValue.value,
  }));

  return (
    <Reanimated.View style={[styles.wrap, { paddingBottom: 8 }, animatedStyle]} pointerEvents="box-none">
        {/* The drop shadow lives on this OUTER wrapper, matching the composer
         * pill. The glass rounds itself (`borderRadius` on the GlassView, no
         * `borderCurve`, which broke it); nothing around it clips or rounds
         * it, which cropped it to a flat fallback (Dubz.tsx has the rules). */}
        <View style={styles.pillShadow}>
        <View>
          <GlassView style={styles.pill} glassEffectStyle="regular" colorScheme={scheme === "dark" ? "dark" : "light"}>
            {/* A plain Feather glyph, not the @expo/ui SystemIcon (a Host): the
             * Host's measurement race (see SystemIcon's own doc) drifted the
             * glyph off-centre on first mount here, fixing only on
             * background/foreground. A vector icon flex-centres reliably and
             * still takes the adaptive PlatformColor. */}
            <Feather name="search" size={21} color={textColors.label} />
            <TextInput
              style={styles.input}
              value={props.value}
              onChangeText={props.onChangeText}
              placeholder={props.placeholder}
              placeholderTextColor={textColors.placeholderText}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
            />
          </GlassView>
        </View>
        </View>
    </Reanimated.View>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    // Match the composer bar's side inset (BottomBar root paddingHorizontal).
    paddingHorizontal: 12,
  },
  // Carries the pill's flex and its small drop shadow (no overflow, so the shadow
  // isn't clipped) — same values as the composer's pillShadow.
  pillShadow: {
    borderRadius: SEARCH_PILL_HEIGHT / 2,
    borderCurve: "continuous",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1.5 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: SEARCH_PILL_HEIGHT,
    paddingHorizontal: 14,
    borderRadius: SEARCH_PILL_HEIGHT / 2,
  },
  input: {
    flex: 1,
    color: text.label,
    fontSize: 16,
    padding: 0,
  },
});
