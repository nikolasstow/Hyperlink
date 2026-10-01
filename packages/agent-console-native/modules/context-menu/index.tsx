/**
 * A view that opens the iOS context menu on a long press (the view lifts, the
 * rest blurs, the actions show under it), around React Native children. It is
 * a plain view to layout, sized by its children like any `View`.
 *
 * `ContextMenuView` renders its children alone (no menu) in a build without the
 * native module.
 *
 * @internal
 */
import { requireNativeView, requireOptionalNativeModule } from "expo";
import * as React from "react";
import { type NativeSyntheticEvent, Platform, View, type ViewProps } from "react-native";

/** One item of the menu (an SF Symbol for its icon). */
export interface MenuAction {
  readonly id: string;
  readonly title: string;
  readonly systemImage?: string;
  readonly destructive?: boolean;
}

type NativeProps = ViewProps & {
  readonly actions: ReadonlyArray<MenuAction>;
  readonly previewCornerRadius: number;
  readonly onAction: (event: NativeSyntheticEvent<{ readonly id: string }>) => void;
};

const available = Platform.OS === "ios" && requireOptionalNativeModule("ContextMenu") !== null;
const NativeView = available ? requireNativeView<NativeProps>("ContextMenu") : undefined;

export const ContextMenuView = (
  props: ViewProps & {
    readonly actions: ReadonlyArray<MenuAction>;
    /** The lifted preview's corner radius (the view's own shape). */
    readonly previewCornerRadius?: number;
    readonly onAction: (id: string) => void;
  },
): React.ReactElement => {
  const { actions, previewCornerRadius, onAction, ...rest } = props;
  if (NativeView === undefined) return <View {...rest} />;
  return <NativeView {...rest} actions={actions} previewCornerRadius={previewCornerRadius ?? 0} onAction={(event) => onAction(event.nativeEvent.id)} />;
};
