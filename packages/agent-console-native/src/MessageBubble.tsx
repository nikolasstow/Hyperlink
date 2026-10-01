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
 * Over a message that opens a new day or follows an hour's quiet, its date
 * (chat/dateHeaders.ts); under your latest message, its read receipt (chat/receipt.ts), as Messages
 * shows it: a set-height line at the bubble's right edge.
 *
 * Your message just sent arrives from the input (`arrival`, messageArrival.ts):
 * its glass and its text are their own animated views for that.
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
import { Clipboard, Share, StyleSheet, Text, useColorScheme, useWindowDimensions, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { ContextMenuView, type MenuAction } from "../modules/context-menu";
import { ROW_GUTTER } from "./layout";
import { type Arrival, BUBBLE_PADDING_HORIZONTAL, BUBBLE_PADDING_VERTICAL, glassArrival, textArrival } from "./messageArrival";
import { Markdown } from "./Markdown";
import { ReasoningBlock } from "./ReasoningBlock";
import { useTextColors, useTheme } from "./theme";
import { colors } from "./colors";
import { dateHeaderLabel } from "./chat/dateHeaders";
import { type Receipt, readTimeLabel } from "./chat/receipt";
import { ToolCallBubble } from "./ToolCallBubble";
import { type ChatMessage, textOf } from "./chat/model";

const MENU: ReadonlyArray<MenuAction> = [
  { id: "copy", title: "Copy", systemImage: "doc.on.doc" },
  { id: "share", title: "Share", systemImage: "square.and.arrow.up" },
];

/** The lifted bubble's corners: yours, its glass's; the agent's prose, soft. */
const USER_RADIUS = 18;
const ASSISTANT_RADIUS = 12;
/** The receipt line under your latest message: its gap above, its line. */
const RECEIPT_GAP = 3;
const RECEIPT_LINE = 16;
export const RECEIPT_HEIGHT = RECEIPT_GAP + RECEIPT_LINE;

/** The space under each message. */
export const MESSAGE_GAP = 14;
/** Your bubble's widest, of the row inside its gutters. */
const USER_MAX_SHARE = 0.88;

const AnimatedGlassView = Reanimated.createAnimatedComponent(GlassView);

const MessageBubbleImpl = (props: {
  readonly message: ChatMessage;
  /** No long-press menu (a preview already inside one). */
  readonly noMenu?: boolean;
  /** Just sent: it arrives from the input (at its mount only). */
  readonly arrival?: Arrival;
  /** Your latest message's read receipt. */
  readonly receipt?: Receipt;
  /** The date over it, when it gets one (epoch ms). */
  readonly dateHeader?: number;
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
  const textWidth = isUser ? Math.floor(rowWidth * USER_MAX_SHARE) - BUBBLE_PADDING_HORIZONTAL * 2 : rowWidth;
  // Read at the mount only, as the entering animations are.
  const [arrival] = React.useState(props.arrival);
  const entering = React.useMemo(
    () => (arrival === undefined ? undefined : { glass: glassArrival(arrival), text: textArrival(arrival) }),
    [arrival],
  );
  React.useLayoutEffect(() => {
    arrival?.onMounted();
  }, [arrival]);
  const parts = props.message.parts.map((part) => {
    switch (part.kind) {
      case "text":
        return <Markdown key={part.id} text={part.text} width={textWidth} />;
      case "reasoning":
        return <ReasoningBlock key={part.id} part={part} />;
      case "tool":
        return <ToolCallBubble key={part.id} part={part} />;
    }
  });
  return (
    <>
      {props.dateHeader !== undefined ? <DateHeader at={props.dateHeader} /> : null}
      <View style={[styles.row, isUser && styles.rowUser]}>
        <ContextMenuView
          style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}
          // Nothing to act on until some prose exists.
          actions={props.noMenu === true || text === "" ? [] : MENU}
          previewCornerRadius={isUser ? USER_RADIUS : ASSISTANT_RADIUS}
          onAction={onAction}
        >
          {/* The user's bubble is glass, tinted with the theme's primary,
           * rounded on itself behind the text; nothing clips it. */}
          {isUser ? (
            <>
              <AnimatedGlassView
                style={[StyleSheet.absoluteFill, styles.bubbleGlass]}
                glassEffectStyle="regular"
                tintColor={themeColors.bubbleGlassTint}
                colorScheme={scheme}
                entering={entering?.glass}
              />
              <Reanimated.View entering={entering?.text}>{parts}</Reanimated.View>
            </>
          ) : (
            parts
          )}
        </ContextMenuView>
        {isUser && props.receipt !== undefined ? <ReceiptLine receipt={props.receipt} /> : null}
      </View>
    </>
  );
};

const DateHeader = (props: { readonly at: number }): React.ReactElement => {
  const textColors = useTextColors();
  const label = dateHeaderLabel(props.at, Date.now());
  return (
    <Text style={[styles.dateHeader, { color: textColors.secondaryLabel }]} numberOfLines={1}>
      <Text style={styles.receiptState}>{label.day}</Text> {label.time}
    </Text>
  );
};

const ReceiptLine = (props: { readonly receipt: Receipt }): React.ReactElement => {
  const textColors = useTextColors();
  const color = { color: props.receipt.kind === "notDelivered" ? colors.destructive : textColors.secondaryLabel };
  switch (props.receipt.kind) {
    case "sending":
      return <Text style={[styles.receipt, color]}>Sending…</Text>;
    case "notDelivered":
      return <Text style={[styles.receipt, styles.receiptState, color]}>Not Delivered</Text>;
    case "delivered":
      return <Text style={[styles.receipt, styles.receiptState, color]}>Delivered</Text>;
    case "read":
      return (
        <Text style={[styles.receipt, color]} numberOfLines={1}>
          <Text style={styles.receiptState}>Read</Text> {readTimeLabel(props.receipt.at, Date.now())}
        </Text>
      );
  }
};
MessageBubbleImpl.displayName = "MessageBubble";

export const MessageBubble = React.memo(MessageBubbleImpl);

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    marginBottom: MESSAGE_GAP,
    paddingHorizontal: ROW_GUTTER,
  },
  // Yours: the bubble, and its receipt under it, at the right.
  rowUser: {
    flexDirection: "column",
    alignItems: "flex-end",
  },
  receipt: {
    marginTop: RECEIPT_GAP,
    marginRight: 6,
    fontSize: 12,
    lineHeight: RECEIPT_LINE,
  },
  receiptState: {
    fontWeight: "600",
  },
  dateHeader: {
    alignSelf: "center",
    marginTop: 4,
    marginBottom: 10,
    fontSize: 12,
    lineHeight: 16,
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
    paddingHorizontal: BUBBLE_PADDING_HORIZONTAL,
    paddingVertical: BUBBLE_PADDING_VERTICAL,
  },
  bubbleGlass: {
    borderRadius: USER_RADIUS,
  },
});
