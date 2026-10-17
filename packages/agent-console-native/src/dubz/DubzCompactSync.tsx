/**
 * Watches the Dubz window's live visible height and reports whether it is
 * compact (dubzLayout.isCompact) to the coordinator when it crosses the zone
 * edge. Renders nothing; a child of the window body, so it reads the height
 * through BarWindowHeightContext.
 *
 * The reaction returns a packed number (no per-frame allocation) and reports
 * only on a change, so the coordinator (and its log) sees a discrete flip, never
 * per-frame churn.
 *
 * @internal
 */
import * as React from "react";
import { runOnJS, type SharedValue, useAnimatedReaction } from "react-native-reanimated";
import { BarWindowHeightContext } from "../BarWindow";
import { COMPOSER_PILL_HEIGHT } from "../composerBarSpec";
import { isCompactWithInput } from "./dubzLayout";

export const DubzCompactSync = (props: { readonly onChange: (compact: boolean) => void; readonly composerFloor: SharedValue<number> }): null => {
  const height = React.useContext(BarWindowHeightContext);
  const { onChange, composerFloor } = props;
  // Compact from the REAL current height and input: a grown composer eats the
  // content room, so it goes compact sooner than the window height alone.
  useAnimatedReaction(
    () => (height !== undefined && isCompactWithInput(height.value, composerFloor.value, COMPOSER_PILL_HEIGHT) ? 1 : 0),
    (next, prev) => {
      if (next !== prev) runOnJS(onChange)(next === 1);
    },
    [height, composerFloor],
  );
  return null;
};
