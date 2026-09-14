/**
 * A session card rendered with `@expo/ui` SwiftUI primitives so it can carry a
 * native `ContextMenu` — long-press lifts the card into a preview with the menu
 * below it (the Messages behavior), and the menu has a real section (Stop).
 *
 * @expo/ui is already in the binary (it's what the header glass uses), so this
 * needs no new dependency and links on Xcode 26 — unlike the third-party context
 * menu library, which drags in SwiftUICore and fails to link.
 *
 * Tap opens the session (`onTapGesture`); long-press opens the menu. The card
 * body is shared between the trigger and the preview.
 *
 * @internal
 */
import { Button, ContextMenu, HStack, Host, Section, Text as UIText, VStack } from "@expo/ui/swift-ui";
import { background, cornerRadius, font, foregroundStyle, lineLimit, onTapGesture, padding } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { useWindowDimensions } from "react-native";
import { colors } from "./colors";

/** Horizontal margin outside the card (matches the list gutter). */
const CARD_GUTTER = 12;

export type SessionCardProps = {
  readonly title: string;
  readonly repo: string;
  readonly worktree?: string;
  readonly meta: string;
  readonly onOpen: () => void;
  readonly onRename: () => void;
  readonly onStop: () => void;
};

const CardBody = (props: { readonly title: string; readonly repo: string; readonly worktree?: string; readonly meta: string }): React.ReactElement => (
  <VStack
    alignment="leading"
    spacing={8}
    modifiers={[padding({ all: 14 }), background(colors.cardBackground), cornerRadius(14)]}
  >
    <UIText modifiers={[font({ size: 17, weight: "semibold" }), foregroundStyle(colors.label), lineLimit(2)]}>{props.title}</UIText>
    <HStack spacing={6} alignment="center">
      <UIText modifiers={[font({ size: 11, weight: "semibold" }), foregroundStyle(colors.secondaryLabel), padding({ horizontal: 8, vertical: 2 }), background(colors.fillBackground), cornerRadius(999)]}>{props.repo}</UIText>
      {props.worktree !== undefined ? (
        <UIText modifiers={[font({ size: 11, weight: "semibold" }), foregroundStyle(colors.tint), padding({ horizontal: 8, vertical: 2 }), background(colors.fillBackground), cornerRadius(999)]}>{props.worktree}</UIText>
      ) : null}
    </HStack>
    <UIText modifiers={[font({ size: 11 }), foregroundStyle(colors.secondaryLabel)]}>{props.meta}</UIText>
  </VStack>
);

export const SessionCard = (props: SessionCardProps): React.ReactElement => {
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = screenWidth - CARD_GUTTER * 2;

  return (
    <Host style={{ width: cardWidth, marginHorizontal: CARD_GUTTER, marginBottom: 10 }} matchContents={{ vertical: true, horizontal: false }}>
      <ContextMenu>
        <ContextMenu.Items>
          <Button label="Open" systemImage="bubble.left.and.bubble.right" onPress={props.onOpen} />
          <Button label="Rename" systemImage="pencil" onPress={props.onRename} />
          <Section>
            <Button label="Stop" role="destructive" systemImage="stop.fill" onPress={props.onStop} />
          </Section>
        </ContextMenu.Items>
        <ContextMenu.Preview>
          <CardBody title={props.title} repo={props.repo} worktree={props.worktree} meta={props.meta} />
        </ContextMenu.Preview>
        <ContextMenu.Trigger>
          <VStack modifiers={[onTapGesture(props.onOpen)]}>
            <CardBody title={props.title} repo={props.repo} worktree={props.worktree} meta={props.meta} />
          </VStack>
        </ContextMenu.Trigger>
      </ContextMenu>
    </Host>
  );
};
