/**
 * A repo/workspace card for Home, rendered with `@expo/ui` SwiftUI primitives so
 * it can carry a native `ContextMenu` — long-press lifts it into a basic-info
 * preview with the repo's action menu (Files · Docs · …) below it, the same menu
 * the repo screen shows in its header (shared via repoMenu). Tap opens the repo.
 *
 * The menu actions are placeholders for now, exactly like the header's — the
 * point is to surface the menu on the card; wiring the sections is future work.
 *
 * @internal
 */
import { Button, ContextMenu, Host, HStack, Image, Spacer, Text as UIText, VStack } from "@expo/ui/swift-ui";
import { background, cornerRadius, font, foregroundStyle, frame, lineLimit, onTapGesture, padding } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { useWindowDimensions } from "react-native";
import { colors } from "./colors";
import { repoMenuFor } from "./repoMenu";

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

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

const Face = (props: { readonly width: number } & RepoCardProps): React.ReactElement => {
  const icon = props.isKnownRepo ? "shippingbox" : "folder";
  return (
    <VStack
      alignment="leading"
      spacing={6}
      modifiers={[padding({ all: 14 }), frame({ width: props.width, alignment: "leading" }), background(colors.cardBackground), cornerRadius(14)]}
    >
      <HStack spacing={7} alignment="center">
        <Image systemName={icon} size={15} color={colors.secondaryLabel} />
        <UIText modifiers={[font({ size: 16, weight: "semibold" }), foregroundStyle(colors.label), lineLimit(1)]}>{props.repo}</UIText>
        <Spacer />
        <Image systemName="chevron.right" size={13} color={colors.secondaryLabel} />
      </HStack>
      {props.mostRecentTitle !== undefined ? (
        <UIText modifiers={[font({ size: 13 }), foregroundStyle(colors.secondaryLabel), lineLimit(1)]}>{props.mostRecentTitle}</UIText>
      ) : null}
      <UIText modifiers={[font({ size: 11 }), foregroundStyle(colors.secondaryLabel)]}>{props.meta}</UIText>
    </VStack>
  );
};

const Preview = (props: { readonly width: number } & RepoCardProps): React.ReactElement => {
  const icon = props.isKnownRepo ? "shippingbox" : "folder";
  return (
    <VStack
      alignment="leading"
      spacing={12}
      modifiers={[padding({ all: 18 }), frame({ width: props.width, alignment: "leading" }), background(colors.cardBackground), cornerRadius(16)]}
    >
      <HStack spacing={9} alignment="center">
        <Image systemName={icon} size={20} color={colors.tint} />
        <UIText modifiers={[font({ size: 20, weight: "semibold" }), foregroundStyle(colors.label), lineLimit(1)]}>{props.repo}</UIText>
      </HStack>
      <VStack alignment="leading" spacing={5}>
        <UIText modifiers={[font({ size: 14 }), foregroundStyle(colors.secondaryLabel)]}>{plural(props.sessionCount, "session")}</UIText>
        {props.worktreeCount > 1 ? (
          <UIText modifiers={[font({ size: 14 }), foregroundStyle(colors.secondaryLabel)]}>{plural(props.worktreeCount, "worktree")}</UIText>
        ) : null}
        <UIText modifiers={[font({ size: 14 }), foregroundStyle(colors.secondaryLabel)]}>{`Last active ${props.lastActive}`}</UIText>
        {props.mostRecentTitle !== undefined ? (
          <UIText modifiers={[font({ size: 14 }), foregroundStyle(colors.label), lineLimit(3)]}>{`Latest: ${props.mostRecentTitle}`}</UIText>
        ) : null}
      </VStack>
    </VStack>
  );
};

export const RepoCard = (props: RepoCardProps): React.ReactElement => {
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = screenWidth - CARD_GUTTER * 2;
  const menu = repoMenuFor(props.isKnownRepo);

  return (
    <Host style={{ marginHorizontal: CARD_GUTTER, marginBottom: 10 }} matchContents={{ vertical: true, horizontal: false }}>
      <ContextMenu>
        <ContextMenu.Items>
          {menu.map((item) => (
            <Button key={item.label} label={item.label} systemImage={item.icon} onPress={() => props.onSelect?.(item.label)} />
          ))}
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
