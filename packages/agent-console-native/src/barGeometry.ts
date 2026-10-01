/**
 * The composer's height as UI-thread values, so the bar and whatever reserves
 * room for it (the chat list's bottom space) move in the same frame.
 *
 * The bar's height is the collapsed pill (COMPOSER_BAR_HEIGHT, a constant)
 * plus what opening adds: the input, the gap above the controls, and the
 * section above the input (Home's pickers, a constant height). `open` runs
 * 0 → 1 as the bar expands; `input` is the input's height. Both animate here,
 * on the UI thread, never through React state or a layout measurement.
 *
 * @internal
 */
import * as React from "react";
import { Easing, type SharedValue, useSharedValue, withTiming } from "react-native-reanimated";

/** A fontSize:16 line of the input. */
export const INPUT_LINE_HEIGHT = 20;
/** The input's padding above and below its text. */
export const INPUT_PADDING_VERTICAL = 8;
/** One line: iOS's multiline TextInput renders no shorter than its content. */
export const MIN_INPUT_HEIGHT = INPUT_LINE_HEIGHT + INPUT_PADDING_VERTICAL * 2;
/** Five lines and a bit; past it, the input scrolls. */
export const MAX_INPUT_HEIGHT = 120;
/** The bar's gap above its controls row while open. */
export const CONTROLS_GAP = 8;
/** The error line above the bar: one line of 16 and its gap. */
export const ERROR_LINE_HEIGHT = 16 + 6;

/** Ease-out close to UIKit's keyboard curve, short enough to feel immediate. */
export const BAR_MOTION = { duration: 180, easing: Easing.bezier(0.2, 0.8, 0.2, 1) };

export interface BarGeometry {
  /** 0 collapsed, 1 open; animated. */
  readonly open: SharedValue<number>;
  /** The input's height (MIN…MAX_INPUT_HEIGHT); animated. */
  readonly input: SharedValue<number>;
  /** 1 while the bar shows an error line above it. */
  readonly error: SharedValue<number>;
}

export const useBarGeometry = (): BarGeometry => {
  const open = useSharedValue(0);
  const input = useSharedValue(MIN_INPUT_HEIGHT);
  const error = useSharedValue(0);
  return React.useMemo(() => ({ open, input, error }), [open, input, error]);
};

/** How much taller than collapsed the bar is now (without a top section). */
export const barExtra = (geometry: BarGeometry): number => {
  "worklet";
  return geometry.open.value * (geometry.input.value + CONTROLS_GAP) + geometry.error.value * ERROR_LINE_HEIGHT;
};

/** Animates the bar open or closed. */
export const setBarOpen = (geometry: BarGeometry, open: boolean): void => {
  geometry.open.value = withTiming(open ? 1 : 0, BAR_MOTION);
};

/** Animates the input to a content height, clamped to one…MAX lines. */
export const setInputHeight = (geometry: BarGeometry, height: number): void => {
  const clamped = Math.min(Math.max(height, MIN_INPUT_HEIGHT), MAX_INPUT_HEIGHT);
  geometry.input.value = withTiming(clamped, BAR_MOTION);
};
