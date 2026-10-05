/**
 * A repo/workspace card for Home, rendered with `@expo/ui` SwiftUI primitives so
 * it can carry a native `ContextMenu` — long-press lifts it into a basic-info
 * preview with the repo's action menu (Files · Docs · …) below it, the same menu
 * the repo screen shows in its header (shared via repoMenu), and Favorite
 * (Home's Favorites). Tap opens the repo.
 *
 * The menu actions are placeholders for now, exactly like the header's — the
 * point is to surface the menu on the card; wiring the sections is future work.
 *
 * @internal
 */
import { Button, ContextMenu, Host, HStack, Image, Section, Spacer, Text as UIText, VStack } from "@expo/ui/swift-ui";
import { font, foregroundStyle, frame, glassEffect, lineLimit, onTapGesture, padding } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { useWindowDimensions } from "react-native";
import { colors } from "./colors";
import { useCardTint, useTextColors } from "./theme";
import { repoMenuFor } from "./repoMenu";
import { CARD_GAP, REPO_CARD_HEIGHT } from "./home/homeLayout";
import { favoriteRepo, isFavorite } from "./favorites/model";
import { toggleFavorite, useFavorites } from "./favorites/useFavorites";

const CARD_GUTTER = 12;

export type RepoCardProps = {
  readonly repo: string;
  readonly isKnownRepo: boolean;
  readonly sessionCount: number;
  readonly worktreeCount: number;
  readonly mostRecentTitle?: string;
  /** Relative time of the repo's most recent activity, e.g. "2h". */
  readonly lastActive: string;
  /** Compact one-line meta for the card face, e.g. "3 sessions · 2 worktrees · 2h". */
  readonly meta: string;
  readonly onOpen: () => void;
  /** Invoked with a menu item's label. Placeholder actions for now. */
  readonly onSelect?: (label: string) => void;
};

/** With its latest session's title, or without. */
const repoCardHeight = (props: RepoCardProps): number => (props.mostRecentTitle !== undefined ? REPO_CARD_HEIGHT.latest : REPO_CARD_HEIGHT.plain);

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

const Face = (props: { readonly width: number } & RepoCardProps): React.ReactElement => {
  const textColors = useTextColors();
  const icon = props.isKnownRepo ? "shippingbox" : "folder";
  // Slightly darker on a light background, lighter on a dark one.
  const tint = useCardTint();
  return (
    <VStack
      alignment="leading"
      spacing={6}
      modifiers={[
        padding({ all: 14 }),
        // Its set height (home/homeLayout.ts), its content at the top.
        frame({ width: props.width, height: repoCardHeight(props), alignment: "topLeading" }),
        glassEffect({ glass: { variant: "regular", tint }, shape: "roundedRectangle", cornerRadius: 14 }),
      ]}
    >
      <HStack spacing={7} alignment="center">
        <Image systemName={icon} size={15} color={textColors.secondaryLabel} />
        <UIText modifiers={[font({ size: 16, weight: "semibold" }), foregroundStyle(textColors.label), lineLimit(1)]}>{props.repo}</UIText>
        <Spacer />
        <Image systemName="chevron.right" size={13} color={textColors.secondaryLabel} />
      </HStack>
      {props.mostRecentTitle !== undefined ? (
        <UIText modifiers={[font({ size: 13 }), foregroundStyle(textColors.secondaryLabel), lineLimit(1)]}>{props.mostRecentTitle}</UIText>
      ) : null}
      <UIText modifiers={[font({ size: 11 }), foregroundStyle(textColors.secondaryLabel)]}>{props.meta}</UIText>
    </VStack>
  );
};

const Preview = (props: { readonly width: number } & RepoCardProps): React.ReactElement => {
  const textColors = useTextColors();
  const icon = props.isKnownRepo ? "shippingbox" : "folder";
  const tint = useCardTint();
  return (
    <VStack
      alignment="leading"
      spacing={12}
      modifiers={[padding({ all: 18 }), frame({ width: props.width, alignment: "leading" }), glassEffect({ glass: { variant: "regular", tint }, shape: "roundedRectangle", cornerRadius: 16 })]}
    >
      <HStack spacing={9} alignment="center">
        <Image systemName={icon} size={20} color={colors.tint} />
        <UIText modifiers={[font({ size: 20, weight: "semibold" }), foregroundStyle(textColors.label), lineLimit(1)]}>{props.repo}</UIText>
      </HStack>
      <VStack alignment="leading" spacing={5}>
        <UIText modifiers={[font({ size: 14 }), foregroundStyle(textColors.secondaryLabel)]}>{plural(props.sessionCount, "session")}</UIText>
        {props.worktreeCount > 1 ? (
          <UIText modifiers={[font({ size: 14 }), foregroundStyle(textColors.secondaryLabel)]}>{plural(props.worktreeCount, "worktree")}</UIText>
        ) : null}
        <UIText modifiers={[font({ size: 14 }), foregroundStyle(textColors.secondaryLabel)]}>{`Last active ${props.lastActive}`}</UIText>
        {props.mostRecentTitle !== undefined ? (
          <UIText modifiers={[font({ size: 14 }), foregroundStyle(textColors.label), lineLimit(3)]}>{`Latest: ${props.mostRecentTitle}`}</UIText>
        ) : null}
      </VStack>
    </VStack>
  );
};

export const RepoCard = (props: RepoCardProps): React.ReactElement => {
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = screenWidth - CARD_GUTTER * 2;
  const menu = repoMenuFor(props.isKnownRepo);
  const favorite = isFavorite(useFavorites(), favoriteRepo(props.repo));

  return (
    <Host
      // Its set height: nothing is measured.
      style={{ marginHorizontal: CARD_GUTTER, marginBottom: CARD_GAP, height: repoCardHeight(props) }}
      // Ignores the safe area: otherwise SwiftUI pads it as it scrolls under
      // the header or the home indicator, so it stretches and shrinks while
      // scrolling and overlaps its neighbours.
      ignoreSafeArea="all"
    >
      <ContextMenu>
        <ContextMenu.Items>
          {menu.map((item) => (
            <Button key={item.label} label={item.label} systemImage={item.icon} onPress={() => props.onSelect?.(item.label)} />
          ))}
          <Section>
            <Button label={favorite ? "Unfavorite" : "Favorite"} systemImage={favorite ? "star.slash" : "star"} onPress={() => void toggleFavorite(favoriteRepo(props.repo))} />
          </Section>
        </ContextMenu.Items>
        <ContextMenu.Preview>
          <Preview width={cardWidth} {...props} />
        </ContextMenu.Preview>
        <ContextMenu.Trigger>
          <VStack modifiers={[onTapGesture(props.onOpen)]}>
            <Face width={cardWidth} {...props} />
          </VStack>
        </ContextMenu.Trigger>
      </ContextMenu>
    </Host>
  );
};
