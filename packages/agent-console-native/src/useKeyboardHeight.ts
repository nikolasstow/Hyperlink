/**
 * Deterministic keyboard-height tracking, in place of
 * `KeyboardAvoidingView` — its "padding" behavior measures its own
 * content's height to compute how much to shrink by, and that measurement
 * was landing wrong in the chat screen (visible as a large gap between the
 * composer and the keyboard). Suspected cause: the composer's buttons are
 * `@expo/ui` `Host`s resolving their size via a native round-trip —
 * plausibly racing with `KeyboardAvoidingView`'s own layout pass. This
 * sidesteps that entirely by tracking the keyboard's real height from
 * native events and applying it directly, no content measurement involved.
 *
 * Shared by every screen that floats a `Composer` over its content (chat
 * and Home both do): the composer is absolutely positioned so content can
 * scroll behind its glass, and absolute children are NOT offset by an
 * ancestor's padding, so each screen has to apply this height explicitly
 * to both the composer's own `bottom` and its list's reserved space.
 *
 * @internal
 */
import * as React from "react";
import { Keyboard, LayoutAnimation } from "react-native";

export const useKeyboardHeight = (): number => {
  const [height, setHeight] = React.useState(0);
  React.useEffect(() => {
    // Animate the height change with the keyboard's OWN duration and curve, so
    // anything positioned by it — the floating composer / search pill and the
    // list's reserved space — slides up and down WITH the keyboard instead of
    // teleporting to the final offset the instant `keyboardWillShow` fires.
    // `keyboardWillShow/Hide` fire at the start of that animation and carry its
    // duration; `Types.keyboard` is UIKit's own keyboard curve.
    const animateTo = (next: number, duration: number): void => {
      LayoutAnimation.configureNext({
        duration: duration > 0 ? duration : 250,
        update: { type: LayoutAnimation.Types.keyboard },
      });
      setHeight(next);
    };
    const showSub = Keyboard.addListener("keyboardWillShow", (e) => animateTo(e.endCoordinates.height, e.duration));
    const hideSub = Keyboard.addListener("keyboardWillHide", (e) => animateTo(0, e.duration));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  return height;
};
