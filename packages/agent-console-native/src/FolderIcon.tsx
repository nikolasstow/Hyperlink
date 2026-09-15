/**
 * The macOS / iOS Files folder icon — a two-tone blue folder: a lighter back
 * sheet with the tab, and a gradient front pocket in front of it, the way the
 * Big Sur+ Finder / Files folder reads. Drawn with SVG (the flat monochrome SF
 * Symbol `folder.fill` doesn't match). Blues are fixed — Files' folders are the
 * same blue in light and dark.
 *
 * @internal
 */
import * as React from "react";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";

/** Folder glyph aspect ratio (width : height). */
const RATIO = 20 / 26;

export const FolderIcon = (props: { readonly size: number }): React.ReactElement => {
  const width = props.size;
  const height = Math.round(props.size * RATIO);
  return (
    <Svg width={width} height={height} viewBox="0 0 26 20">
      <Defs>
        <LinearGradient id="folderBack" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#B6DAFB" />
          <Stop offset="1" stopColor="#8AC2F8" />
        </LinearGradient>
        <LinearGradient id="folderFront" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#7BBCF9" />
          <Stop offset="1" stopColor="#3B93F0" />
        </LinearGradient>
      </Defs>
      {/* Back sheet + tab (its top edge shows above the front pocket). */}
      <Path
        fill="url(#folderBack)"
        d="M3 2.4 h5.5 a1.8 1.8 0 0 1 1.3 0.56 l1.5 1.56 h9.9 a2.5 2.5 0 0 1 2.5 2.5 V15 a2.5 2.5 0 0 1 -2.5 2.5 H3 A2.5 2.5 0 0 1 0.5 15 V4.9 A2.5 2.5 0 0 1 3 2.4 Z"
      />
      {/* Front pocket, gradient, slightly wider and rounded. */}
      <Rect x="0.4" y="6.4" width="25.2" height="11.4" rx="2.7" fill="url(#folderFront)" />
    </Svg>
  );
};
