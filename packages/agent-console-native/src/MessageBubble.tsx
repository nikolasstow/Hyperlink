/**
 * User = right-aligned bubble of glass tinted with the theme's primary;
 * assistant = plain left-aligned text,
 * no bubble — the pattern ChatGPT/Claude's own clients use, not a dev-tool
 * log. Ported from packages/agent-console/src/components/MessageBubble.tsx,
 * with markdown via `Markdown.tsx` (no Shiki — monospaced fences only).
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
import { StyleSheet, useColorScheme, View } from "react-native";
import { ROW_GUTTER } from "./layout";
import { Markdown } from "./Markdown";
import { MessageActions } from "./MessageActions";
import { ReasoningBlock } from "./ReasoningBlock";
import { useTheme } from "./theme";
import { ToolCallBubble } from "./ToolCallBubble";
import type { ChatMessage } from "./chat/model";

const MessageBubbleImpl = (props: { readonly message: ChatMessage; readonly hideActions?: boolean }): React.ReactElement => {
  const isUser = props.message.role === "user";
  const { colors: themeColors } = useTheme();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return (
    <View style={[styles.row, isUser && styles.rowUser]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
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
              return <Markdown key={part.id} text={part.text} />;
            case "reasoning":
              return <ReasoningBlock key={part.id} part={part} />;
            case "tool":
              return <ToolCallBubble key={part.id} part={part} />;
          }
        })}
        {/* Assistant only: there is nothing to copy back out of your own
          * message, and a row of controls under every sent line is noise. */}
        {isUser || props.hideActions === true ? null : <MessageActions message={props.message} />}
      </View>
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
    maxWidth: "88%",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleGlass: {
    borderRadius: 18,
  },
});
