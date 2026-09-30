/**
 * The files the agent has been touching, as a row of glass chips over the
 * chat's bar, scrolling sideways when they outrun the width. A pencil marks a
 * file it changed; a page, one it only read. Selected chips (attached to the
 * next message) wear the theme's primary tint and lead the row, the others
 * making way with a spring as they reorder.
 *
 * One native region (a SwiftUI horizontal ScrollView in one Host), its box set
 * by React Native: the screen's width and a set height.
 *
 * @internal
 */
import { Host, HStack, Image, ScrollView, Text } from "@expo/ui/swift-ui";
import { Animation, animation, font, foregroundStyle, frame, glassEffect, lineLimit, onTapGesture, padding, scrollIndicators } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import type { SessionFile } from "./sessionFiles";
import { useCardTint, useTextColors, useTheme } from "./theme";

const CHIP_HEIGHT = 30;
/** The row's height: a chip and a little room above and below. */
export const FILE_CHIPS_HEIGHT = CHIP_HEIGHT + 10;

export const FileChips = (props: {
  /** In the order shown: the selected first. */
  readonly files: ReadonlyArray<SessionFile>;
  readonly selected: ReadonlySet<string>;
  /** Changes whenever the order does, to animate the reorder. */
  readonly orderVersion: number;
  readonly width: number;
  readonly onPress: (file: SessionFile) => void;
}): React.ReactElement | null => {
  const textColors = useTextColors();
  const tint = useCardTint();
  const { colors: themeColors } = useTheme();
  if (props.files.length === 0) return null;
  return (
    <Host style={{ width: props.width, height: FILE_CHIPS_HEIGHT }} ignoreSafeArea="all">
      <ScrollView axes="horizontal" modifiers={[scrollIndicators("hidden")]}>
        <HStack
          spacing={8}
          modifiers={[padding({ horizontal: 20, vertical: 5 }), animation(Animation.spring({ duration: 0.35, bounce: 0.15 }), props.orderVersion)]}
        >
          {props.files.map((file) => {
            const selected = props.selected.has(file.path);
            return (
              <HStack
                key={file.path}
                spacing={5}
                modifiers={[
                  padding({ horizontal: 12 }),
                  frame({ height: CHIP_HEIGHT }),
                  glassEffect({ glass: { variant: "regular", interactive: true, tint: selected ? themeColors.bubbleGlassTint : tint }, shape: "capsule" }),
                  onTapGesture(() => props.onPress(file)),
                ]}
              >
                <Image systemName={file.edited ? "pencil" : "doc.text"} size={11} color={textColors.secondaryLabel} />
                <Text modifiers={[font({ size: 13, weight: selected ? "semibold" : "medium" }), foregroundStyle(textColors.label), lineLimit(1)]}>{file.name}</Text>
              </HStack>
            );
          })}
        </HStack>
      </ScrollView>
    </Host>
  );
};
