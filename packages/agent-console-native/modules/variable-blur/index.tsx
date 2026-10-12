/**
 * Progressive backdrop blur — blur radius ramps along one edge via private
 * `CAFilter.variableBlur`. iOS only; renders nothing elsewhere.
 *
 * @internal
 */
import { requireNativeModule, requireNativeView } from "expo";
import * as React from "react";
import { Platform, type ViewProps } from "react-native";

export type VariableBlurProps = ViewProps & {
  readonly blurRadius?: number;
  /** `up` = blur strongest at the top edge; `down` = strongest at the bottom. */
  readonly direction?: "up" | "down";
};

const NativeView =
  Platform.OS === "ios" ? requireNativeView<VariableBlurProps>("VariableBlur") : null;

export const VariableBlur = (props: VariableBlurProps): React.ReactElement | null =>
  NativeView === null ? null : <NativeView {...props} />;

// ── SwiftUI variant (for @expo/ui Hosts) ────────────────────────────────────

const variableBlurModule: { readonly hasSwiftUIBlur?: boolean } | null =
  Platform.OS === "ios" ? requireNativeModule("VariableBlur") : null;

/** True when this native build ships the SwiftUI blur view. Gate any use on it
 * so older builds (without the view) stay inert instead of rendering nothing /
 * warning — set once the new build lands. */
export const hasNativeSwiftUIBlur: boolean = variableBlurModule?.hasSwiftUIBlur === true;

export type VariableBlurSwiftUIProps = {
  readonly blurRadius?: number;
  /** `up` = blur strongest at the top edge; `down` = strongest at the bottom. */
  readonly direction?: "up" | "down";
  /** The feather's height (it fills its width). */
  readonly height?: number;
};

const NativeSwiftUIBlur = hasNativeSwiftUIBlur
  ? requireNativeView<VariableBlurSwiftUIProps>("VariableBlur", "VariableBlurSwiftUIView")
  : null;

/** The variable blur as a native SwiftUI view — a valid `@expo/ui` `Host`
 * child. Renders nothing until the native build provides it. */
export const VariableBlurSwiftUI = (props: VariableBlurSwiftUIProps): React.ReactElement | null =>
  NativeSwiftUIBlur === null ? null : <NativeSwiftUIBlur {...props} />;
