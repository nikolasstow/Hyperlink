/**
 * Draws one of VS Code's codicons (codiconGlyphs.ts) as SVG, in one colour, the
 * way VS Code draws them: the whole em square is the icon, so every icon
 * sits the same in its slot.
 *
 * @internal
 */
import * as React from "react";
import type { ColorValue } from "react-native";
import Svg, { G, Path } from "react-native-svg";
import { CODICON_UNITS_PER_EM, type CodiconName, codicons } from "./codiconGlyphs";

export const Codicon = (props: { readonly name: CodiconName; readonly size: number; readonly color: ColorValue }): React.ReactElement => {
  const em = CODICON_UNITS_PER_EM;
  return (
    <Svg width={props.size} height={props.size} viewBox={`0 0 ${em} ${em}`}>
      <G transform={`translate(0, ${em}) scale(1, -1)`}>
        <Path d={codicons[props.name]} fill={props.color} />
      </G>
    </Svg>
  );
};
