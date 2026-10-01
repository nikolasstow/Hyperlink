/**
 * User = right-aligned bubble of glass tinted with the theme's primary;
 * assistant = plain left-aligned text,
 * no bubble — the pattern ChatGPT/Claude's own clients use, not a dev-tool
 * log. Ported from packages/agent-console/src/components/MessageBubble.tsx,
 * with markdown via `Markdown.tsx` (no Shiki — monospaced fences only).
 *
 * Long-press any message (yours or the agent's) for the iOS context menu:
 * the bubble lifts, and Copy / Share act on its prose. Reasoning and tool
 * output are collapsed detail; sweeping them into a copy would produce
 * something nobody meant to paste.
 *
 * Memoized for the same reason as the web version: `useSessionStream`'s
 * updater only creates a new `TranscriptMessage` object for the message an
 * incoming event actually touched, so this skips re-rendering every other
 * bubble during a streaming response.
 *
 * @internal
 */
import * as React from "react";
import { GlassView } from "expo-glass-effect";
import { Clipboard, Share, StyleSheet, useColorScheme, useWindowDimensions, View } from "react-native";
import { ContextMenuView, type MenuAction } from "../modules/context-menu";
import { ROW_GUTTER } from "./layout";
import { Markdown } from "./Markdown";
import { ReasoningBlock } from "./ReasoningBlock";
import { useTheme } from "./theme";
import { ToolCallBubble } from "./ToolCallBubble";
import { type ChatMessage, textOf } from "./chat/model";

const MENU: ReadonlyArray<MenuAction> = [
  { id: "copy", title: "Copy", systemImage: "doc.on.doc" },
  { id: "share", title: "Share", systemImage: "square.and.arrow.up" },
];

/** The lifted bubble's corners: yours, its glass's; the agent's prose, soft. */
const USER_RADIUS = 18;
const ASSISTANT_RADIUS = 12;
/** Your bubble's widest, of the row inside its gutters. */
const USER_MAX_SHARE = 0.88;
const USER_PADDING_HORIZONTAL = 14;
const USER_PADDING_VERTICAL = 10;

const MessageBubbleImpl = (props: {
  readonly message: ChatMessage;
  /** No long-press menu (a preview already inside one). */
  readonly noMenu?: boolean;
}): React.ReactElement => {
  const isUser = props.message.role === "user";
  const text = textOf(props.message).trim();
  const onAction = (id: string): void => {
    if (id === "copy") Clipboard.setString(text);
    if (id === "share") void Share.share({ message: text });
  };
  const { colors: themeColors } = useTheme();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  // The width the text lays out in: the row inside its gutters (the agent's),
  // or your bubble's widest inside its padding.
  const { width: windowWidth } = useWindowDimensions();
  const rowWidth = windowWidth - ROW_GUTTER * 2;
  const textWidth = isUser ? Math.floor(rowWidth * USER_MAX_SHARE) - USER_PADDING_HORIZONTAL * 2 : rowWidth;
  return (
    <View style={[styles.row, isUser && styles.rowUser]}>
      <ContextMenuView
        style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}
        // Nothing to act on until some prose exists.
        actions={props.noMenu === true || text === "" ? [] : MENU}
        previewCornerRadius={isUser ? USER_RADIUS : ASSISTANT_RADIUS}
        onAction={onAction}
      >
        {/* The user's bubble is glass, tinted with the theme's primary,
         * rounded on itself behind the text; nothing clips it. Still queued
         * (not on the server yet), it is untinted. */}
        {isUser ? (
          <GlassView
            style={[StyleSheet.absoluteFill, styles.bubbleGlass]}
            glassEffectStyle="regular"
            tintColor={props.message.queued === true ? undefined : themeColors.bubbleGlassTint}
            colorScheme={scheme}
          />
        ) : null}
        {props.message.parts.map((part) => {
          switch (part.kind) {
            case "text":
              return <Markdown key={part.id} text={part.text} width={textWidth} />;
            case "reasoning":
              return <ReasoningBlock key={part.id} part={part} />;
            case "tool":
              return <ToolCallBubble key={part.id} part={part} />;
          }
        })}
      </ContextMenuView>
    </View>
  );
};
MessageBubbleImpl.displayName = "MessageBubble";

export const MessageBubble = React.memo(MessageBubbleImpl);

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    marginBottom: 14,
    paddingHorizontal: ROW_GUTTER,
  },
  rowUser: {
    justifyContent: "flex-end",
  },
  bubble: {},
  bubbleAssistant: {
    // Full width: assistant replies are prose, code and tool output, and the
    // right-hand gutter a chat bubble normally reserves just wraps them
    // earlier for no benefit.
    flex: 1,
  },
  bubbleUser: {
    // Still inset — a sent message reads as a bubble, and the asymmetry is
    // what distinguishes the two sides now that replies run edge to edge.
    maxWidth: `${USER_MAX_SHARE * 100}%`,
    paddingHorizontal: USER_PADDING_HORIZONTAL,
    paddingVertical: USER_PADDING_VERTICAL,
  },
  bubbleGlass: {
    borderRadius: USER_RADIUS,
  },
});
