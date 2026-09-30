/**
 * The files the agent has been touching, as a row of glass chips over the
 * chat's bar: newest first, scrolling sideways when they outrun the width. A
 * pencil marks a file it changed; a page, one it only read.
 *
 * One native region (a SwiftUI horizontal ScrollView in one Host), its box set
 * by React Native: the screen's width and a set height.
 *
 * @internal
 */
import { Host, HStack, Image, ScrollView, Text } from "@expo/ui/swift-ui";
import { font, foregroundStyle, frame, glassEffect, lineLimit, onTapGesture, padding, scrollIndicators } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import type { SessionFile } from "./sessionFiles";
import { useCardTint, useTextColors } from "./theme";

const CHIP_HEIGHT = 30;
/** The row's height: a chip and a little room above and below. */
export const FILE_CHIPS_HEIGHT = CHIP_HEIGHT + 10;

export const FileChips = (props: {
  readonly files: ReadonlyArray<SessionFile>;
  readonly width: number;
  readonly onPress: (file: SessionFile) => void;
}): React.ReactElement | null => {
  const textColors = useTextColors();
  const tint = useCardTint();
  if (props.files.length === 0) return null;
  return (
    <Host style={{ width: props.width, height: FILE_CHIPS_HEIGHT }} ignoreSafeArea="all">
      <ScrollView axes="horizontal" modifiers={[scrollIndicators("hidden")]}>
        <HStack spacing={8} modifiers={[padding({ horizontal: 20, vertical: 5 })]}>
          {props.files.map((file) => (
            <HStack
              key={file.path}
              spacing={5}
              modifiers={[
                padding({ horizontal: 12 }),
                frame({ height: CHIP_HEIGHT }),
                glassEffect({ glass: { variant: "regular", interactive: true, tint }, shape: "capsule" }),
                onTapGesture(() => props.onPress(file)),
              ]}
            >
              <Image systemName={file.edited ? "pencil" : "doc.text"} size={11} color={textColors.secondaryLabel} />
              <Text modifiers={[font({ size: 13, weight: "medium" }), foregroundStyle(textColors.label), lineLimit(1)]}>{file.name}</Text>
            </HStack>
          ))}
        </HStack>
      </ScrollView>
    </Host>
  );
};
