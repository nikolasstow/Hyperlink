/**
 * A native slider (SwiftUI) whose thumb rests only on the given stops: the
 * track runs over their values, so they sit at their amount along it, and
 * each stop landed on gives iOS's selection haptic.
 *
 * `DetentSlider` is undefined in a build without the native module (it came
 * in after the current build): callers fall back to another slider.
 *
 * @internal
 */
import { requireNativeView, requireOptionalNativeModule } from "expo";
import * as React from "react";
import { Platform, type NativeSyntheticEvent, type ViewProps } from "react-native";

type NativeProps = ViewProps & {
  readonly stops: ReadonlyArray<number>;
  readonly value: number;
  readonly onChange: (event: NativeSyntheticEvent<{ readonly value: number }>) => void;
};

export type DetentSliderProps = ViewProps & {
  readonly stops: ReadonlyArray<number>;
  readonly value: number;
  readonly onValueChange: (value: number) => void;
};

const available = Platform.OS === "ios" && requireOptionalNativeModule("DetentSlider") !== null;
const NativeView = available ? requireNativeView<NativeProps>("DetentSlider") : undefined;

const DetentSliderImpl = (props: DetentSliderProps): React.ReactElement | null => {
  const { onValueChange, ...rest } = props;
  return NativeView === undefined ? null : <NativeView {...rest} onChange={(event) => onValueChange(event.nativeEvent.value)} />;
};

/** The native slider, or undefined where this build has none. */
export const DetentSlider: ((props: DetentSliderProps) => React.ReactElement | null) | undefined = available ? DetentSliderImpl : undefined;
