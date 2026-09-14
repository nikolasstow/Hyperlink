/**
 * The iOS Files folder icon — a tabbed folder with the system-blue vertical
 * gradient, drawn with SVG. The flat monochrome SF Symbol `folder.fill` reads as
 * "wrong" next to the real Files list, which uses this gradient folder; SVG lets
 * us match it. The blues are fixed (Files' folders are the same blue in light and
 * dark), not PlatformColor.
 *
 * @internal
 */
import * as React from "react";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

/** Folder aspect ratio (width : height) of the drawn glyph. */
const RATIO = 21 / 28;

export const FolderIcon = (props: { readonly size: number }): React.ReactElement => {
  const width = props.size;
  const height = Math.round(props.size * RATIO);
  return (
    <Svg width={width} height={height} viewBox="0 0 28 21">
      <Defs>
        <LinearGradient id="folderBlue" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#7CBBFA" />
          <Stop offset="1" stopColor="#2C8CF0" />
        </LinearGradient>
      </Defs>
      <Path
        fill="url(#folderBlue)"
        d="M3.6 2 h6 a2 2 0 0 1 1.5 0.68 l1.3 1.45 h9.9 a3 3 0 0 1 3 3 v8.4 a3 3 0 0 1 -3 3 H3.6 a3 3 0 0 1 -3 -3 V5 a3 3 0 0 1 3 -3 Z"
      />
    </Svg>
  );
};
