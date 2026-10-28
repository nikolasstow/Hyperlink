/**
 * A print's 3D model from the relay, in SceneKit: one finger turns it, two
 * fingers move it, and a pinch zooms. `uri` is a `model.mesh` file on the
 * device (src/printer/printModel.ts). iOS only; renders nothing elsewhere.
 *
 * @internal
 */
import { requireNativeView } from "expo";
import * as React from "react";
import { Platform, type ViewProps } from "react-native";

export type ModelViewerProps = ViewProps & {
  /** A `model.mesh` file on the device, as a `file://` URI. */
  readonly uri: string | undefined;
  /** The model's colour, `#rrggbb`. */
  readonly color: string;
};

const NativeView = Platform.OS === "ios" ? requireNativeView<ModelViewerProps>("ModelViewer") : null;

export const ModelViewer = (props: ModelViewerProps): React.ReactElement | null => (NativeView === null ? null : <NativeView {...props} />);
