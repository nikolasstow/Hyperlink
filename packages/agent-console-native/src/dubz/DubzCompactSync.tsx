/**
 * Watches the Dubz window's live visible height and reports the compact display
 * mode (dubzLayout) to the coordinator when it crosses a threshold. Renders
 * nothing; it is a child of the window body, so it reads the height through
 * BarWindowHeightContext.
 *
 * The reaction returns a packed number (no per-frame allocation) and reports
 * only on a change, so the coordinator (and its log) sees a discrete flip, never
 * per-frame churn.
 *
 * @internal
 */
import * as React from "react";
import { runOnJS, useAnimatedReaction } from "react-native-reanimated";
import { BarWindowHeightContext } from "../BarWindow";
import { isCompact, needsCompactContent } from "./dubzLayout";

export const DubzCompactSync = (props: {
  /** The window height the content wants (requested), including both bars. */
  readonly claim: number;
  readonly topBar: number;
  readonly bottomBar: number;
  readonly onChange: (compact: boolean, compactContent: boolean) => void;
}): null => {
  const height = React.useContext(BarWindowHeightContext);
  const { claim, topBar, bottomBar, onChange } = props;
  useAnimatedReaction(
    () => {
      const h = height === undefined ? 0 : height.value;
      // The content's own height is the claim without its two bars; it needs to
      // compact when that is taller than the live viewport (height − bars).
      const compact = isCompact(h);
      const compactContent = needsCompactContent(h, claim - topBar - bottomBar, topBar, bottomBar);
      return (compact ? 1 : 0) | (compactContent ? 2 : 0);
    },
    (next, prev) => {
      if (next !== prev) runOnJS(onChange)((next & 1) !== 0, (next & 2) !== 0);
    },
    [height, claim, topBar, bottomBar],
  );
  return null;
};
