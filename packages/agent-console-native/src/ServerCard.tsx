/**
 * A server card for Home, drawn with the same `@expo/ui` SwiftUI glass face as
 * RepoCard so servers sit on Home as a sibling category to repos. Tap opens the
 * server's page. No context menu yet — Phase 1 is the plain card; its menu
 * (and widgets) come with the plugin work.
 *
 * @internal
 */
import { Host, HStack, Image, Spacer, Text as UIText, VStack } from "@expo/ui/swift-ui";
import { font, foregroundStyle, frame, glassEffect, lineLimit, onTapGesture, padding } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { useWindowDimensions } from "react-native";
import { CARD_GAP, SERVER_CARD_HEIGHT } from "./home/homeLayout";
import { useCardTint, useTextColors } from "./theme";

const CARD_GUTTER = 12;

export interface ServerCardProps {
  readonly name: string;
  readonly address: string;
  readonly onOpen: () => void;
}

export const ServerCard = (props: ServerCardProps): React.ReactElement => {
  const textColors = useTextColors();
  const tint = useCardTint();
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = screenWidth - CARD_GUTTER * 2;
  return (
    <Host
      // Its set height: nothing is measured. ignoreSafeArea so SwiftUI doesn't
      // pad it as it scrolls under the header (RepoCard's own note).
      style={{ marginHorizontal: CARD_GUTTER, marginBottom: CARD_GAP, height: SERVER_CARD_HEIGHT }}
      ignoreSafeArea="all"
    >
      <VStack
        alignment="leading"
        spacing={6}
        modifiers={[
          padding({ all: 14 }),
          frame({ width: cardWidth, height: SERVER_CARD_HEIGHT, alignment: "topLeading" }),
          glassEffect({ glass: { variant: "regular", tint }, shape: "roundedRectangle", cornerRadius: 14 }),
          onTapGesture(props.onOpen),
        ]}
      >
        <HStack spacing={7} alignment="center">
          <Image systemName="server.rack" size={15} color={textColors.secondaryLabel} />
          <UIText modifiers={[font({ size: 16, weight: "semibold" }), foregroundStyle(textColors.label), lineLimit(1)]}>{props.name}</UIText>
          <Spacer />
          <Image systemName="chevron.right" size={13} color={textColors.secondaryLabel} />
        </HStack>
        <UIText modifiers={[font({ size: 11 }), foregroundStyle(textColors.secondaryLabel), lineLimit(1)]}>{props.address}</UIText>
      </VStack>
    </Host>
  );
};
