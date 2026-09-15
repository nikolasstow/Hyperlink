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

/** Folder glyph aspect ratio (height ÷ width). Taller than the classic wide
 * folder — closer to the Mac/Files proportions. */
const RATIO = 23 / 26;

export const FolderIcon = (props: { readonly size: number }): React.ReactElement => {
  const width = props.size;
  const height = Math.round(props.size * RATIO);
  return (
    <Svg width={width} height={height} viewBox="0 0 26 23">
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
        d="M3 2.8 h5.6 a1.9 1.9 0 0 1 1.35 0.58 l1.45 1.5 h10 a2.6 2.6 0 0 1 2.6 2.6 V16.5 a2.6 2.6 0 0 1 -2.6 2.6 H3 A2.6 2.6 0 0 1 0.4 16.5 V5.4 A2.6 2.6 0 0 1 3 2.8 Z"
      />
      {/* Front pocket, gradient, slightly wider and rounded. */}
      <Rect x="0.4" y="7.4" width="25.2" height="13.4" rx="2.9" fill="url(#folderFront)" />
    </Svg>
  );
};
