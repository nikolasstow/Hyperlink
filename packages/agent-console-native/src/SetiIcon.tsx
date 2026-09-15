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

/** Fraction of the size the glyph is inset from the icon's edges. */
const PAD = 0.06;

export const SetiIcon = (props: { readonly glyph: string; readonly size: number }): React.ReactElement | null => {
  const glyph = setiGlyphs[props.glyph];
  if (glyph === undefined) return null;
  const upm = SETI_UNITS_PER_EM;
  const [x0, y0, x1, y1] = glyph.box;
  // The glyph fills only part of the em and varies in shape, so frame it by its
  // own bounds (flipped y-up → y-down) with a small pad; `meet` preserves the
  // aspect and centres it, so every icon renders as large as the slot allows.
  const w = x1 - x0;
  const h = y1 - y0;
  const pad = Math.max(w, h) * PAD;
  const vx = x0 - pad;
  const vy = upm - y1 - pad;
  const vw = w + pad * 2;
  const vh = h + pad * 2;
  return (
    <Svg width={props.size} height={props.size} viewBox={`${vx} ${vy} ${vw} ${vh}`} preserveAspectRatio="xMidYMid meet">
      <G transform={`translate(0, ${upm}) scale(1, -1)`}>
        <Path d={glyph.path} fill={glyph.color} />
      </G>
    </Svg>
  );
};
