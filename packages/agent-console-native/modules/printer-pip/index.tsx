/**
 * The source of the printer's Picture in Picture: the camera or the current
 * layer, whichever page of the stage was open. iOS starts the window by
 * itself when the owner leaves the app while `enabled` is on. Its skip
 * buttons switch between the camera and the layer. iOS only;
 * renders nothing elsewhere.
 *
 * @internal
 */
import { requireNativeView } from "expo";
import * as React from "react";
import { Platform, type ViewProps } from "react-native";

export type PrinterPipProps = ViewProps & {
  readonly mode: "camera" | "layer";
  /** The relay's `/api/camera.h264` WebSocket. */
  readonly cameraUrl: string | undefined;
  /** The current layer image (white or alpha pixels on transparent). */
  readonly layerUri: string | undefined;
  /** The colour lit layer pixels are drawn in. */
  readonly tint: string;
  /** Width over height of the LCD, for the layer frame. */
  readonly aspect: number;
  /** The phase label while a print runs ("Exposing", "Lifting", …). */
  readonly phase: string | undefined;
  /** True while the printer exposes a layer: the lit pixels glow. */
  readonly exposing: boolean;
  /** True while a print runs. */
  readonly active: boolean;
  /** The glow around lit pixels. */
  readonly glowColor: string;
  /** The phase text while the printer exposes. */
  readonly phaseColor: string;
  /** The dot in the phase chip while the printer exposes. */
  readonly dotColor: string;
  /** The print's progress, 0 to 100. */
  readonly percent: number | undefined;
  /** The progress bar's gradient, left to right. */
  readonly progressColors: ReadonlyArray<string>;
  /** The print's elapsed and remaining time: the window's timeline. */
  readonly elapsedMs: number | undefined;
  readonly remainingMs: number | undefined;
  /** True while the stage is on screen: only then does leaving the app start the window. */
  readonly enabled: boolean;
};

const NativeView = Platform.OS === "ios" ? requireNativeView<PrinterPipProps>("PrinterPip") : null;

export const PrinterPip = (props: PrinterPipProps): React.ReactElement | null => (NativeView === null ? null : <NativeView {...props} />);
