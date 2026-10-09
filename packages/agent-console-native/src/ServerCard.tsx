/**
 * A server card for Home, drawn with the same `@expo/ui` SwiftUI glass face as
 * RepoCard so servers sit on Home as a sibling category to repos. Tap opens the
 * server's page; long-press lifts it into a preview with a Favorite action that
 * pins it to the surface's scope (Home → Home favorites).
 *
 * @internal
 */
import { Button, ContextMenu, Host, HStack, Image, Spacer, Text as UIText, VStack } from "@expo/ui/swift-ui";
import { font, foregroundStyle, frame, glassEffect, lineLimit, onTapGesture, padding } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { useWindowDimensions } from "react-native";
import { serverTarget } from "./favorites/model";
import { toggleFavorite, useFavoriteScope, useIsFavorited } from "./favorites/useFavorites";
import { CARD_GAP, SERVER_CARD_HEIGHT } from "./home/homeLayout";
import { useCardTint, useTextColors } from "./theme";

const CARD_GUTTER = 12;

export interface ServerCardProps {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly onOpen: () => void;
}

/** The glass face — shared by the tap target and the long-press preview. */
const Face = (props: { readonly width: number } & Omit<ServerCardProps, "onOpen">): React.ReactElement => {
  const textColors = useTextColors();
  const tint = useCardTint();
  return (
    <VStack
      alignment="leading"
      spacing={6}
      modifiers={[
        padding({ all: 14 }),
        frame({ width: props.width, height: SERVER_CARD_HEIGHT, alignment: "topLeading" }),
        glassEffect({ glass: { variant: "regular", tint }, shape: "roundedRectangle", cornerRadius: 14 }),
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
  );
};

export const ServerCard = (props: ServerCardProps): React.ReactElement => {
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = screenWidth - CARD_GUTTER * 2;
  const scope = useFavoriteScope();
  const favorite = useIsFavorited(scope, serverTarget(props.id));
  return (
    <Host
      // Its set height: nothing is measured. ignoreSafeArea so SwiftUI doesn't
      // pad it as it scrolls under the header (RepoCard's own note).
      style={{ marginHorizontal: CARD_GUTTER, marginBottom: CARD_GAP, height: SERVER_CARD_HEIGHT }}
      ignoreSafeArea="all"
    >
      <ContextMenu>
        <ContextMenu.Items>
          <Button
            label={favorite ? "Unfavorite" : "Favorite"}
            systemImage={favorite ? "star.slash" : "star"}
            onPress={() => void toggleFavorite(scope, serverTarget(props.id))}
          />
        </ContextMenu.Items>
        <ContextMenu.Preview>
          <Face width={cardWidth} id={props.id} name={props.name} address={props.address} />
        </ContextMenu.Preview>
        <ContextMenu.Trigger>
          <VStack modifiers={[onTapGesture(props.onOpen)]}>
            <Face width={cardWidth} id={props.id} name={props.name} address={props.address} />
          </VStack>
        </ContextMenu.Trigger>
      </ContextMenu>
    </Host>
  );
};
