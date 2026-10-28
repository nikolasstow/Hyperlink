/**
 * A print's 3D model from the relay, in SceneKit: one finger turns it, two
 * fingers move it, and a pinch zooms. A new `uri` with the same bounds (a
 * finer level) keeps the view. A crop shows the inside. `uri` is a `model.mesh` file on the
 * device (src/printer/printModel.ts). iOS only; renders nothing elsewhere.
 *
 * `presentModelAR` shows the same model in AR (AR Quick Look), at its real
 * size, in its colour, with the crop applied.
 *
 * @internal
 */
import { requireNativeModule, requireNativeView } from "expo";
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

interface ModelViewerNativeModule {
  readonly presentAR?: (uri: string, color: string, clipLowMm: number | null, clipHighMm: number | null, title: string) => Promise<void>;
}

const nativeModule = Platform.OS === "ios" ? requireNativeModule<ModelViewerNativeModule>("ModelViewer") : undefined;

/** Whether this build can show a model in AR. */
export const canPresentModelAR = nativeModule?.presentAR !== undefined;

/** Shows the model in AR over the app. Resolves once AR Quick Look is on screen. */
export const presentModelAR = (options: {
  readonly uri: string;
  readonly color: string;
  readonly clipLowMm: number | undefined;
  readonly clipHighMm: number | undefined;
  readonly title: string;
}): Promise<void> =>
  nativeModule?.presentAR === undefined
    ? Promise.reject(new Error("This build cannot show AR"))
    : nativeModule.presentAR(options.uri, options.color, options.clipLowMm ?? null, options.clipHighMm ?? null, options.title);

export const ModelViewer = (props: ModelViewerProps): React.ReactElement | null => (NativeView === null ? null : <NativeView {...props} />);
