/**
 * The send animation: your message leaves the input as its bubble.
 *
 * The bubble's row mounts in the chat list (behind the bar, which is glass,
 * so it shows through) and its entering animations start it at the input's
 * exact frame: the glass as big as the input, the text where the input's text
 * was. Then the glass shrinks to the bubble, its right edge pinned, the text
 * riding its left padding; part way through, both rise into the row.
 *
 * Nothing is measured. The row's frame is Reanimated's target for the
 * entering animation (Yoga's own layout); the input's is the bar's geometry
 * (barGeometry.ts) and the keyboard, read on the UI thread at the mount. Both
 * are in the bubble's coordinates: the list's row cells are flipped twice
 * (the inverted list, then each cell), so a cell lays out upright, y down.
 *
 * @internal
 */
import {
  type EntryAnimationsValues,
  type EntryExitAnimationFunction,
  type SharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { barExtra, BAR_MOTION, type BarGeometry, CONTROLS_GAP, INPUT_PADDING_VERTICAL } from "./barGeometry";
import { COMPOSER_BAR_HEIGHT, COMPOSER_FIELD_PADDING, COMPOSER_SEND_CHIP_SIZE } from "./composerBarSpec";
import { ROW_GUTTER } from "./layout";

/** The bar's side margin (BottomBar root) and its field's padding: where the
 * input's box starts. */
const INPUT_INSET = 12 + COMPOSER_FIELD_PADDING;
/** The input's own padding before its text (Composer's input style). */
const INPUT_TEXT_INSET = 4;
/** From the bar's bottom to the input's: the bar's padding under its pill,
 * the field's padding, the controls row (as tall as the send chip). */
const BAR_BOTTOM_TO_CONTROLS_TOP = 8 + COMPOSER_FIELD_PADDING + COMPOSER_SEND_CHIP_SIZE;

/** Your bubble's padding around its text (MessageBubble). */
export const BUBBLE_PADDING_HORIZONTAL = 14;
export const BUBBLE_PADDING_VERTICAL = 10;

const SHRINK = BAR_MOTION;
const RISE_DELAY = 100;
const RISE = { duration: 260, easing: BAR_MOTION.easing };
/** The whole flight, to its landing. */
export const ARRIVAL_MS = Math.max(SHRINK.duration, RISE_DELAY + RISE.duration);

/** Where the arriving message's input was, as UI-thread values. */
interface ArrivalSource {
  readonly geometry: BarGeometry;
  readonly keyboard: SharedValue<number>;
  /** Where the bar rests with the keyboard down. */
  readonly restingBottom: number;
  /** Between the bar's room (BarSpace) and the row's bottom: the file chips,
   * BarSpace's gap, the busy row, the row's own margin. */
  readonly between: number;
}

export interface Arrival extends ArrivalSource {
  /** Called once the row has mounted (the input can clear then). */
  readonly onMounted: () => void;
}

/** Only the values: the worklets never capture the JS callback. */
const sourceOf = (arrival: Arrival): ArrivalSource => ({
  geometry: arrival.geometry,
  keyboard: arrival.keyboard,
  restingBottom: arrival.restingBottom,
  between: arrival.between,
});

interface Start {
  /** The input's box, in the bubble's coordinates. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const startOf = (source: ArrivalSource, bubbleWidth: number, bubbleHeight: number, windowWidth: number): Start => {
  "worklet";
  const geometry = source.geometry;
  const barBottom = Math.max(source.keyboard.value, source.restingBottom);
  // Distances up from the screen's bottom.
  const inputBottom = barBottom + BAR_BOTTOM_TO_CONTROLS_TOP + geometry.open.value * CONTROLS_GAP;
  const inputTop = inputBottom + geometry.input.value;
  const rowBottom = barBottom + COMPOSER_BAR_HEIGHT + barExtra(geometry) + source.between;
  const bubbleLeft = windowWidth - ROW_GUTTER - bubbleWidth;
  return {
    x: INPUT_INSET - bubbleLeft,
    y: rowBottom + bubbleHeight - inputTop,
    width: windowWidth - INPUT_INSET * 2,
    height: geometry.input.value,
  };
};

/** The bubble's glass: from the input's box to the bubble's. */
export const glassArrival = (arrival: Arrival): EntryExitAnimationFunction => {
  const source = sourceOf(arrival);
  return (values: EntryAnimationsValues) => {
    "worklet";
    const start = startOf(source, values.targetWidth, values.targetHeight, values.windowWidth);
    return {
      initialValues: {
        originX: values.targetOriginX + start.x,
        originY: values.targetOriginY + start.y,
        width: start.width,
        height: start.height,
      },
      animations: {
        originX: withTiming(values.targetOriginX, SHRINK),
        width: withTiming(values.targetWidth, SHRINK),
        height: withTiming(values.targetHeight, SHRINK),
        originY: withDelay(RISE_DELAY, withTiming(values.targetOriginY, RISE)),
      },
    };
  };
};

/** The bubble's text: from where the input's text was to its place. */
export const textArrival = (arrival: Arrival): EntryExitAnimationFunction => {
  const source = sourceOf(arrival);
  return (values: EntryAnimationsValues) => {
    "worklet";
    const bubbleWidth = values.targetWidth + BUBBLE_PADDING_HORIZONTAL * 2;
    const bubbleHeight = values.targetHeight + BUBBLE_PADDING_VERTICAL * 2;
    const start = startOf(source, bubbleWidth, bubbleHeight, values.windowWidth);
    const dx = start.x + INPUT_TEXT_INSET - BUBBLE_PADDING_HORIZONTAL;
    const dy = start.y + INPUT_PADDING_VERTICAL - BUBBLE_PADDING_VERTICAL;
    return {
      initialValues: {
        transform: [{ translateX: dx }, { translateY: dy }],
      },
      animations: {
        transform: [{ translateX: withTiming(0, SHRINK) }, { translateY: withDelay(RISE_DELAY, withTiming(0, RISE)) }],
      },
    };
  };
};
