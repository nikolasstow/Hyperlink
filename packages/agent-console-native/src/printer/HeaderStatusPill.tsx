/**
 * The printer's state in the header's right slot: a Liquid Glass capsule
 * with a coloured dot and a word ("Printing 42%", "Paused", "Ready"). It is
 * the same capsule as HeaderTitlePill (titlePillStyle.ts), smaller.
 *
 * The width comes from the label, so nothing is measured after render.
 *
 * @internal
 */
import { HStack, Host, Image, Text as UIText } from "@expo/ui/swift-ui";
import { font, foregroundStyle, frame, glassEffect, lineLimit, padding } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { PILL_DOT_GAP, PILL_DOT_SIZE } from "../titlePillStyle";
import { useTextColors } from "../theme";

const HEIGHT = 32;
const FONT_SIZE = 13;
const PAD_H = 11;
/** Average glyph advance for the system font at semibold, a little generous so the label never truncates. */
const GLYPH_RATIO = 0.62;

/** The capsule's width for a label: the header keeps this much room for it. */
export const statusPillWidth = (label: string): number => Math.ceil(label.length * FONT_SIZE * GLYPH_RATIO) + PAD_H * 2 + PILL_DOT_SIZE + PILL_DOT_GAP;

export const HeaderStatusPill = (props: { readonly label: string; readonly color: string }): React.ReactElement => {
  const text = useTextColors();
  const width = statusPillWidth(props.label);
  return (
    <Host style={{ width, height: HEIGHT }} ignoreSafeArea="all">
      <HStack
        alignment="center"
        spacing={PILL_DOT_GAP}
        modifiers={[
          frame({ width, height: HEIGHT }),
          padding({ horizontal: PAD_H }),
          glassEffect({ glass: { variant: "regular" }, shape: "capsule" }),
        ]}
      >
        <Image
          systemName="circle.fill"
          size={PILL_DOT_SIZE}
          color={props.color}
        />
        <UIText modifiers={[font({ size: FONT_SIZE, weight: "semibold" }), foregroundStyle(text.label), lineLimit(1)]}>{props.label}</UIText>
      </HStack>
    </Host>
  );
};
