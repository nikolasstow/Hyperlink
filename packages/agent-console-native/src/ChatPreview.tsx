/**
 * The chat rendered small, for a session card's long-press preview. It reuses
 * the real `MessageBubble` (markdown, right-aligned user bubbles, tool calls,
 * reasoning) so the preview matches the chat exactly — just actions-less and
 * scrolled to the newest message.
 *
 * This is plain React Native, mounted inside SwiftUI via `@expo/ui`'s
 * `RNHostView` (see SessionCard). Fixed to `width` × `height`; the messages sit
 * flush to the bottom and overflow clips at the top, so the latest turn shows
 * the way it would if you'd just opened the session. No header — just the chat.
 *
 * @internal
 */
import * as React from "react";
import { StyleSheet, Text, View } from "react-native";
import { CollapsiblePartsProvider } from "./CollapsibleParts";
import { colors } from "./colors";
import { ROW_GUTTER } from "./layout";
import { MessageBubble } from "./MessageBubble";
import type { Transcript } from "./useSessionStream";

/** Trailing messages to mount — bounded so a long history stays cheap; the
 * container clips whatever doesn't fit. */
const TAIL = 12;

export const ChatPreview = (props: {
  readonly transcript: Transcript | undefined;
  readonly width: number;
  readonly height: number;
}): React.ReactElement => {
  const order = props.transcript?.order ?? [];
  const tail = order.slice(-TAIL);

  return (
    <View style={[styles.card, { width: props.width, height: props.height }]}>
      {tail.length === 0 ? (
        <Text style={styles.empty}>{props.transcript === undefined ? "Loading preview…" : "No messages yet."}</Text>
      ) : (
        <CollapsiblePartsProvider newestID={undefined}>
          {tail.map((id) => {
            const message = props.transcript?.messages.get(id);
            return message === undefined ? null : <MessageBubble key={id} message={message} hideActions />;
          })}
        </CollapsiblePartsProvider>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    // Newest message flush to the bottom; older content overflows and clips at
    // the top — the "scrolled to bottom" view you'd land on opening the session.
    backgroundColor: colors.cardBackground,
    borderRadius: 14,
    overflow: "hidden",
    justifyContent: "flex-end",
    paddingBottom: 10,
    paddingTop: 12,
  },
  empty: {
    color: colors.secondaryLabel,
    fontSize: 13,
    paddingHorizontal: ROW_GUTTER,
    paddingBottom: 14,
  },
});
