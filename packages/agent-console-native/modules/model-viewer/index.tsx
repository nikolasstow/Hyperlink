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
import { Platform, type NativeSyntheticEvent, type ViewProps } from "react-native";

export type ModelViewerProps = ViewProps & {
  /** A `model.mesh` file on the device, as a `file://` URI. */
  readonly uri: string | undefined;
  /** The model's colour, `#rrggbb`. */
  readonly color: string;
  /** The crop: the model shows only between these heights above the plate, in mm. Undefined: no crop on that side. */
  readonly clipLowMm?: number | undefined;
  readonly clipHighMm?: number | undefined;
  /** A plan's supports beside the model: a `model.mesh` file in the same frame, in their own colour. */
  readonly supportsUri?: string | undefined;
  readonly supportsColor?: string | undefined;
  /** Points to mark in the model's frame (mm): requirements, the selected support. */
  readonly markers?: ReadonlyArray<ModelMarker> | undefined;
  /** One support tree's triangles (a `model.mesh` file), drawn over everything: the selected support, whole. */
  readonly highlightUri?: string | undefined;
  readonly highlightColor?: string | undefined;
  /** The cut box's x and y ranges (mm, the model's frame). With a range set, the view frames the box. */
  readonly clipMinX?: number | undefined;
  readonly clipMaxX?: number | undefined;
  readonly clipMinY?: number | undefined;
  readonly clipMaxY?: number | undefined;
  /** How opaque the model and the supports are, 0 to 1. */
  readonly modelOpacity?: number | undefined;
  readonly supportsOpacity?: number | undefined;
  /** "support" paints on the highlighted support, "model" on the model: one finger paints, two fingers turn, a pinch zooms. */
  readonly paintMode?: "off" | "support" | "model" | undefined;
  readonly paintColor?: string | undefined;
  /** A finished stroke: its points on the target's surface, x y z in mm, flat. */
  readonly onPaintStroke?: ((points: ReadonlyArray<number>) => void) | undefined;
  /** A tap, as a ray in the model's frame (mm): it passes through the model and every support. */
  readonly onRayTap?: ((ray: ModelTapRay) => void) | undefined;
};

export interface ModelMarker {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color: string;
  readonly radius: number;
}

/** A tap as a ray: the camera's position, the unit direction through the finger, and the finger's spread in radians. */
export interface ModelTapRay {
  readonly ox: number;
  readonly oy: number;
  readonly oz: number;
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly spread: number;
}

type NativeProps = Omit<ModelViewerProps, "onRayTap" | "onPaintStroke"> & {
  readonly onRayTap?: (event: NativeSyntheticEvent<ModelTapRay>) => void;
  readonly onPaintStroke?: (event: NativeSyntheticEvent<{ readonly points: ReadonlyArray<number> }>) => void;
};

const NativeView = Platform.OS === "ios" ? requireNativeView<NativeProps>("ModelViewer") : null;

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

export const ModelViewer = (props: ModelViewerProps): React.ReactElement | null => {
  const { onRayTap, onPaintStroke, ...rest } = props;
  return NativeView === null ? null : (
    <NativeView
      {...rest}
      onRayTap={onRayTap === undefined ? undefined : (event) => onRayTap(event.nativeEvent)}
      onPaintStroke={onPaintStroke === undefined ? undefined : (event) => onPaintStroke(event.nativeEvent.points)}
    />
  );
};
