/**
 * The chat rendered small, for a session card's long-press preview. It reuses
 * the real `MessageBubble` (markdown, right-aligned user bubbles, tool calls,
 * reasoning) so the preview matches the chat exactly — just actions-less and
 * scrolled to the newest message.
 *
 * This is plain React Native, mounted inside SwiftUI via `@expo/ui`'s
 * `RNHostView` (see SessionCard). Fixed to `width` × `height`; the messages sit
 * flush to the bottom and overflow clips at the top, so the latest turn shows
 * the way it would if you'd just opened the session.
 *
 * The title sits on an opaque bar so content scrolling up passes under a defined
 * header rather than colliding with it and turning unreadable. It is deliberately
 * NOT glass: a context-menu preview is an isolated platter, so a translucent
 * material (blur/Liquid Glass) has no live backdrop to sample and renders empty
 * there — an opaque bar is the only header that reliably shows.
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
/** Height reserved for the floating title so the newest content clears it. */
const HEADER_HEIGHT = 44;

export const ChatPreview = (props: {
  readonly transcript: Transcript | undefined;
  readonly title: string;
  readonly width: number;
  readonly height: number;
}): React.ReactElement => {
  const order = props.transcript?.order ?? [];
  const tail = order.slice(-TAIL);

  return (
    <View style={[styles.card, { width: props.width, height: props.height }]}>
      <View style={[styles.body, { paddingTop: HEADER_HEIGHT + 8 }]}>
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
      {/* Opaque header bar — content scrolls under it and is hidden, so the
        * newest turn stays legible. Not glass; see the note above. */}
      <View style={styles.header} pointerEvents="none">
        <Text style={styles.title} numberOfLines={1}>
          {props.title}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    position: "relative",
    backgroundColor: colors.cardBackground,
    borderRadius: 14,
    overflow: "hidden",
  },
  body: {
    // Newest message flush to the bottom; older content overflows and clips at
    // the top (under the glass) — the "scrolled to bottom" view you'd land on.
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "flex-end",
    paddingBottom: 10,
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: HEADER_HEIGHT,
    justifyContent: "center",
    paddingHorizontal: ROW_GUTTER,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  title: {
    color: colors.label,
    fontSize: 15,
    fontWeight: "600",
  },
  empty: {
    color: colors.secondaryLabel,
    fontSize: 13,
    paddingHorizontal: ROW_GUTTER,
    paddingBottom: 14,
  },
});
