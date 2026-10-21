/**
 * The source of the printer's Picture in Picture: the camera or the current
 * layer, whichever page of the stage was open. iOS starts the window by
 * itself when the owner leaves the app while `enabled` is on. iOS only;
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
  /** True while the stage is on screen: only then does leaving the app start the window. */
  readonly enabled: boolean;
};

const NativeView = Platform.OS === "ios" ? requireNativeView<PrinterPipProps>("PrinterPip") : null;

export const PrinterPip = (props: PrinterPipProps): React.ReactElement | null => (NativeView === null ? null : <NativeView {...props} />);
