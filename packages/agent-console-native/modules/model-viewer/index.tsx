/**
 * A print's 3D model from the relay, in SceneKit: one finger turns it, two
 * fingers move it, and a pinch zooms. A new `uri` with the same bounds (a
 * finer level) keeps the view. A crop shows the inside. `uri` is a `model.mesh` file on the
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
  /** The crop: the model shows only between these heights above the plate, in mm. Undefined: no crop on that side. */
  readonly clipLowMm?: number | undefined;
  readonly clipHighMm?: number | undefined;
};

const NativeView = Platform.OS === "ios" ? requireNativeView<ModelViewerProps>("ModelViewer") : null;

export const ModelViewer = (props: ModelViewerProps): React.ReactElement | null => (NativeView === null ? null : <NativeView {...props} />);
