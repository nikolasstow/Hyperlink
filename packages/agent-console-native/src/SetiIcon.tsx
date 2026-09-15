/**
 * Renders one Seti (VS Code default) file-icon glyph as SVG — react-native-svg
 * is already in the binary, so this needs no icon font and no rebuild.
 *
 * The glyphs are stored in font units with the y-axis pointing up (baseline at
 * 0); SVG's y-axis points down, so the path is flipped within the em square
 * (`translate(0, upm) scale(1, -1)`). The colour is the theme's own, baked into
 * the glyph; `iconForFile` resolves a filename to the glyph key.
 *
 * @internal
 */
import * as React from "react";
import Svg, { G, Path } from "react-native-svg";
import { SETI_UNITS_PER_EM, setiGlyphs } from "./setiIcons";

export const SetiIcon = (props: { readonly glyph: string; readonly size: number }): React.ReactElement | null => {
  const glyph = setiGlyphs[props.glyph];
  if (glyph === undefined) return null;
  const upm = SETI_UNITS_PER_EM;
  return (
    <Svg width={props.size} height={props.size} viewBox={`0 0 ${upm} ${upm}`}>
      <G transform={`translate(0, ${upm}) scale(1, -1)`}>
        <Path d={glyph.path} fill={glyph.color} />
      </G>
    </Svg>
  );
};
