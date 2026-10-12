/**
 * Shown over an open file while an outside change (an agent's, mostly) met
 * lines you were editing: the file shows their version, lit in the editor,
 * and this offers yours back — Keep Mine puts your lines over theirs, Keep
 * Theirs lets yours go. One conflict at a time, the first in the file.
 *
 * One native region (a SwiftUI row in one Host), its box set by React Native:
 * the width given and a set height.
 *
 * @internal
 */
import { Host, HStack, Image, Spacer, Text } from "@expo/ui/swift-ui";
import { contentShape, font, foregroundStyle, frame, glassEffect, lineLimit, onTapGesture, padding, shapes } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { useCardTint, useTextColors } from "../theme";

export const CONFLICT_BAR_HEIGHT = 48;
const BUTTON_HEIGHT = 32;

export const ConflictBar = (props: {
  /** Conflicts in the file. */
  readonly count: number;
  readonly width: number;
  readonly onKeepMine: () => void;
  readonly onKeepTheirs: () => void;
}): React.ReactElement => {
  const textColors = useTextColors();
  const tint = useCardTint();
  const button = (label: string, onPress: () => void) => (
    <Text
      modifiers={[
        font({ size: 14, weight: "semibold" }),
        foregroundStyle(textColors.label),
        padding({ horizontal: 12 }),
        frame({ height: BUTTON_HEIGHT }),
        glassEffect({ glass: { variant: "regular", interactive: true, tint }, shape: "capsule" }),
        contentShape(shapes.capsule()),
        onTapGesture(onPress),
      ]}
    >
      {label}
    </Text>
  );
  return (
    <Host style={{ width: props.width, height: CONFLICT_BAR_HEIGHT }} ignoreSafeArea="all">
      <HStack
        spacing={8}
        modifiers={[
          padding({ horizontal: 12 }),
          frame({ height: CONFLICT_BAR_HEIGHT }),
          glassEffect({ glass: { variant: "regular", tint }, shape: "capsule" }),
        ]}
      >
        <Image systemName="exclamationmark.triangle.fill" size={14} color="#FF9F0A" />
        <Text modifiers={[font({ size: 14, weight: "medium" }), foregroundStyle(textColors.label), lineLimit(1)]}>
          {props.count === 1 ? "Changed under your edit" : `${props.count} changed under your edits`}
        </Text>
        <Spacer />
        {button("Keep Mine", props.onKeepMine)}
        {button("Keep Theirs", props.onKeepTheirs)}
      </HStack>
    </Host>
  );
};
