/**
 * What a `/` word offers, as a glass card over the composer's bar: a row per
 * command or skill (its name, what it does, where it comes from), the top one
 * highlighted as the one space accepts. A tap accepts a row.
 *
 * One native region (a SwiftUI stack in one Host), its box set by React
 * Native: the bar's width and a height from the row count (rows are a set
 * height).
 *
 * @internal
 */
import type { Commands } from "agent-console-protocol";
import { Host, HStack, Text, VStack, Divider, Spacer } from "@expo/ui/swift-ui";
import { background, contentShape, font, foregroundStyle, frame, glassEffect, lineLimit, onTapGesture, padding, shapes } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { useCardTint, useTheme } from "../theme";

const ROW_HEIGHT = 50;
const RADIUS = 22;
/** The highlight's inset inside the card, so it rounds inside it. */
const INSET = 4;
/** The card's side inset: the bar's. */
const SLASH_LIST_MARGIN = 12;
/** Room under the card, between it and the bar. */
const GAP = 8;

/** The card's height for `count` rows, its gap to the bar included. */
export const slashListHeight = (count: number): number => count * ROW_HEIGHT + 2 * INSET + GAP;

const SOURCE_LABEL: Record<Commands.Source, string> = {
  command: "Command",
  skill: "Skill",
};

export const SlashList = (props: {
  readonly entries: ReadonlyArray<Commands.Entry>;
  readonly width: number;
  readonly onAccept: (entry: Commands.Entry) => void;
}): React.ReactElement | null => {
  const tint = useCardTint();
  const { colors: themeColors } = useTheme();
  if (props.entries.length === 0) return null;
  return (
    <Host style={{ width: props.width, height: slashListHeight(props.entries.length) }} ignoreSafeArea="all">
      <VStack
        spacing={0}
        alignment="leading"
        modifiers={[
          padding({ all: INSET }),
          glassEffect({ glass: { variant: "regular", tint }, shape: "roundedRectangle", cornerRadius: RADIUS }),
          padding({ horizontal: SLASH_LIST_MARGIN, bottom: GAP }),
        ]}
      >
        {props.entries.map((entry, index) => (
          <VStack key={entry.id} spacing={0} alignment="leading">
            {index > 0 ? <Divider modifiers={[padding({ horizontal: 12 })]} /> : null}
            <HStack
              spacing={8}
              modifiers={[
                padding({ horizontal: 12 }),
                frame({ height: ROW_HEIGHT - (index > 0 ? 1 : 0), maxWidth: Infinity, alignment: "leading" }),
                ...(index === 0 ? [background(themeColors.bubbleGlassTint, shapes.roundedRectangle({ cornerRadius: RADIUS - INSET }))] : []),
                contentShape(shapes.rectangle()),
                onTapGesture(() => props.onAccept(entry)),
              ]}
            >
              <VStack spacing={2} alignment="leading">
                <Text modifiers={[font({ size: 15, weight: "semibold" }), lineLimit(1)]}>{`/${entry.name}`}</Text>
                {entry.description !== undefined ? (
                  <Text modifiers={[font({ size: 12 }), foregroundStyle({ type: "hierarchical", style: "secondary" }), lineLimit(1)]}>{entry.description}</Text>
                ) : null}
              </VStack>
              <Spacer />
              <Text modifiers={[font({ size: 12 }), foregroundStyle({ type: "hierarchical", style: "tertiary" }), lineLimit(1)]}>{SOURCE_LABEL[entry.source]}</Text>
            </HStack>
          </VStack>
        ))}
      </VStack>
    </Host>
  );
};
