/**
 * The keyboard's height, tracked ONCE for the whole app.
 *
 * Every `useAnimatedKeyboard` is its own native keyboard listener, alive as
 * long as its component is mounted. With a bar on every screen, each with its
 * own tracker (the bar riding the keyboard, and its Dubz page sizing itself),
 * a stack of screens ran several at once, all the time; an always-on tracker
 * like this is what once bogged the whole app down. So one tracker at the root,
 * and everything reads its shared value.
 *
 * @internal
 */
import * as React from "react";
import { useAnimatedKeyboard, type SharedValue } from "react-native-reanimated";

const KeyboardHeightContext = React.createContext<SharedValue<number> | undefined>(undefined);

/** Mounted once, at the app's root. */
export const KeyboardHeightProvider = (props: { readonly children: React.ReactNode }): React.ReactElement => {
  // Destructured: the whole KeyboardImpl object cannot be captured by a worklet.
  const { height } = useAnimatedKeyboard();
  return <KeyboardHeightContext.Provider value={height}>{props.children}</KeyboardHeightContext.Provider>;
};

/** The keyboard's live height (0 when down), a shared value for worklets. */
export const useKeyboardHeightValue = (): SharedValue<number> => {
  const height = React.useContext(KeyboardHeightContext);
  if (height === undefined) throw new Error("useKeyboardHeightValue must be used within a KeyboardHeightProvider");
  return height;
};
