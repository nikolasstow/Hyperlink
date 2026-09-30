/**
 * A native (SwiftUI) row of capsule tabs, scrolling sideways, the selected one
 * on glass. A tab with an icon collapses to it while another is selected, its
 * title narrowing away; every change of selection springs. Put it inside an
 * @expo/ui Host (it is a SwiftUI view, laid out by SwiftUI).
 *
 * `CapsuleTabs` is undefined in a build without the native module (it came in
 * after the current build): callers fall back to another strip.
 *
 * @internal
 */
import { requireNativeView, requireOptionalNativeModule } from "expo";
import * as React from "react";
import { type NativeSyntheticEvent, Platform } from "react-native";

/** One tab. */
export interface CapsuleTab {
  readonly id: string;
  readonly title: string;
  /** An SF Symbol; the tab shows only it while not selected. */
  readonly systemImage?: string;
}

type NativeProps = {
  readonly tabs: ReadonlyArray<CapsuleTab>;
  readonly selection: string;
  readonly tint?: string;
  readonly sideMargin: number;
  readonly onSelect: (event: NativeSyntheticEvent<{ readonly id: string }>) => void;
};

export interface CapsuleTabsProps {
  readonly tabs: ReadonlyArray<CapsuleTab>;
  readonly selection: string;
  /** The selected tab's glass tint. */
  readonly tint?: string;
  readonly sideMargin: number;
  readonly onSelect: (id: string) => void;
}

const available = Platform.OS === "ios" && requireOptionalNativeModule("CapsuleTabs") !== null;
const NativeView = available ? requireNativeView<NativeProps>("CapsuleTabs") : undefined;

const CapsuleTabsImpl = (props: CapsuleTabsProps): React.ReactElement | null => {
  const { onSelect, ...rest } = props;
  return NativeView === undefined ? null : <NativeView {...rest} onSelect={(event) => onSelect(event.nativeEvent.id)} />;
};

/** The native strip, or undefined where this build has none. */
export const CapsuleTabs: ((props: CapsuleTabsProps) => React.ReactElement | null) | undefined = available ? CapsuleTabsImpl : undefined;
