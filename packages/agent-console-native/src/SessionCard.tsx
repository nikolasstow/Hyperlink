/**
 * A session card rendered with `@expo/ui` SwiftUI primitives so it can carry a
 * native `ContextMenu` — long-press lifts the card into a preview with the menu
 * below it (the Messages behavior), and the menu has a real section (Stop).
 *
 * @expo/ui is already in the binary (it's what the header glass uses), so this
 * needs no new dependency and links on Xcode 26 — unlike the third-party context
 * menu library, which drags in SwiftUICore and fails to link.
 *
 * The trigger is the compact SwiftUI card. The preview embeds the REAL chat via
 * `@expo/ui`'s `RNHostView` — a React Native view hosted inside the SwiftUI
 * preview — so it renders with the chat's own markdown/bubbles (see ChatPreview),
 * loaded cache-first and filled in lazily (see sessionPreview.ts).
 *
 * @internal
 */
import { Button, Circle, ContextMenu, Host, HStack, RNHostView, Section, Text as UIText, VStack } from "@expo/ui/swift-ui";
import { background, cornerRadius, font, foregroundStyle, frame, lineLimit, onTapGesture, padding } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { useWindowDimensions } from "react-native";
import { ChatPreview } from "./ChatPreview";
import type { OpencodeClient } from "./client";
import { colors } from "./colors";
import { lastMessageSummary, useSessionPreview } from "./sessionPreview";
import { useTheme } from "./theme";

/** Horizontal margin outside the card (matches the list gutter). */
const CARD_GUTTER = 12;
/** Preview height — "nearly half a page". */
const PREVIEW_HEIGHT_FRACTION = 0.5;

export type SessionCardProps = {
  readonly client: OpencodeClient;
  readonly sessionId: string;
  /** Server-side last-updated time; keys the preview transcript cache. */
  readonly updatedAt: number;
  readonly title: string;
  /** Repo badge — omitted on a repo's own page, where it's redundant. */
  readonly repo?: string;
  readonly worktree?: string;
  readonly meta: string;
  /** Whether the agent is running now — gates the destructive Stop action. */
  readonly running: boolean;
  /** Whether the session has activity since it was last opened. */
  readonly unread: boolean;
  /** Whether to lazily load the preview/summary (e.g. only while Home is focused). */
  readonly previewEnabled: boolean;
  readonly onOpen: () => void;
  readonly onRename: () => void;
  readonly onStop: () => void;
};

const summaryLabel = (role: "user" | "assistant", text: string): string => (role === "user" ? `You: ${text}` : text);

// An exact `frame` width (row width = screen minus the gutters), left-aligned,
// sits between the padding and the background so the rounded fill spans the row
// (SwiftUI hugs content otherwise) while the text stays left-aligned.
const CardBody = (props: {
  readonly width: number;
  readonly title: string;
  readonly repo?: string;
  readonly worktree?: string;
  readonly meta: string;
  readonly unread: boolean;
  readonly unreadColor: string;
  readonly summary?: string;
}): React.ReactElement => (
  <VStack
    alignment="leading"
    spacing={8}
    modifiers={[padding({ all: 14 }), frame({ width: props.width, alignment: "leading" }), background(colors.cardBackground), cornerRadius(14)]}
  >
    <HStack spacing={7} alignment="center">
      {props.unread ? <Circle modifiers={[frame({ width: 8, height: 8 }), foregroundStyle(props.unreadColor)]} /> : null}
      <UIText modifiers={[font({ size: 17, weight: "semibold" }), foregroundStyle(colors.label), lineLimit(2)]}>{props.title}</UIText>
    </HStack>
    {props.repo !== undefined || props.worktree !== undefined ? (
      <HStack spacing={6} alignment="center">
        {props.repo !== undefined ? (
          <UIText modifiers={[font({ size: 11, weight: "semibold" }), foregroundStyle(colors.secondaryLabel), padding({ horizontal: 8, vertical: 2 }), background(colors.fillBackground), cornerRadius(999)]}>{props.repo}</UIText>
        ) : null}
        {props.worktree !== undefined ? (
          <UIText modifiers={[font({ size: 11, weight: "semibold" }), foregroundStyle(colors.tint), padding({ horizontal: 8, vertical: 2 }), background(colors.fillBackground), cornerRadius(999)]}>{props.worktree}</UIText>
        ) : null}
      </HStack>
    ) : null}
    {props.summary !== undefined ? (
      <UIText modifiers={[font({ size: 13 }), foregroundStyle(colors.secondaryLabel), lineLimit(2)]}>{props.summary}</UIText>
    ) : null}
    <UIText modifiers={[font({ size: 11 }), foregroundStyle(colors.secondaryLabel)]}>{props.meta}</UIText>
  </VStack>
);

export const SessionCard = (props: SessionCardProps): React.ReactElement => {
  const { colors: themeColors } = useTheme();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const cardWidth = screenWidth - CARD_GUTTER * 2;
  const previewHeight = Math.round(screenHeight * PREVIEW_HEIGHT_FRACTION);
  const transcript = useSessionPreview(props.client, props.sessionId, props.updatedAt, props.previewEnabled);
  const summary = lastMessageSummary(transcript);

  return (
    <Host style={{ marginHorizontal: CARD_GUTTER, marginBottom: 10 }} matchContents={{ vertical: true, horizontal: false }}>
      <ContextMenu>
        <ContextMenu.Items>
          <Button label="Open" systemImage="bubble.left.and.bubble.right" onPress={props.onOpen} />
          <Button label="Rename" systemImage="pencil" onPress={props.onRename} />
          {props.running ? (
            <Section>
              <Button label="Stop" role="destructive" systemImage="stop.fill" onPress={props.onStop} />
            </Section>
          ) : null}
        </ContextMenu.Items>
        <ContextMenu.Preview>
          <RNHostView matchContents>
            <ChatPreview transcript={transcript} width={cardWidth} height={previewHeight} />
          </RNHostView>
        </ContextMenu.Preview>
        <ContextMenu.Trigger>
          <VStack modifiers={[onTapGesture(props.onOpen)]}>
            <CardBody
              width={cardWidth}
              title={props.title}
              repo={props.repo}
              worktree={props.worktree}
              meta={props.meta}
              unread={props.unread}
              unreadColor={themeColors.secondary}
              summary={summary === undefined ? undefined : summaryLabel(summary.role, summary.text)}
            />
          </VStack>
        </ContextMenu.Trigger>
      </ContextMenu>
    </Host>
  );
};
