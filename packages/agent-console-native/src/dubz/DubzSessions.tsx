/**
 * Sessions inside the Dubz window. On a page that publishes an editable document,
 * Dubz shows one session row: a big pill with the most related session and a
 * number pill with how many sessions live in that file's worktree, together
 * filling the width. Tap the big pill to open that session; tap the number for
 * the full list (related first, then by recency). A session opens as the real
 * chat — the actual MessageBubble transcript — in the Dubz window, with a
 * full-screen button to the proper session page.
 *
 * Glass here is SwiftUI (`Host` + `glassEffect`), the only glass that renders
 * inside the window's own glass — `expo-glass-effect` nested in it does not.
 * Pills are a fixed size computed from the screen (nothing measured).
 *
 * First cut: the transcript is the kept/preview conversation (live streaming and
 * continuing from the Dubz pill are next).
 *
 * @internal
 */
import { Host, HStack, Image, Text as UIText } from "@expo/ui/swift-ui";
import { contentShape, font, foregroundStyle, frame, glassEffect, lineLimit, onTapGesture, padding, shapes } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useAppContext } from "../AppContext";
import { chatMessageOfV1 } from "../chat/fromV1";
import { CollapsiblePartsProvider } from "../CollapsibleParts";
import type { FileRef } from "../dubzSuggestions";
import { MessageBubble } from "../MessageBubble";
import { cachedSessionsNow } from "../sessionCache";
import { useSessionPreview } from "../sessionPreview";
import { SystemIcon } from "../SystemIcon";
import { type TextColors, useTextColors, useThemedStyles, useTheme } from "../theme";
import { sessionsForFile } from "./sessionsForFile";

/** The session a row/list opens, as the sub-page needs it. */
export interface DubzOpenSession {
  readonly id: string;
  readonly title: string;
  readonly updated: number;
  readonly directory: string;
}

const ROW_HEIGHT = 44;
const NUMBER_WIDTH = 56;
const ROW_GAP = 8;
/** The suggestions area's horizontal padding (Dubz makeStyles). */
const AREA_PADDING = 16;

const relativeTime = (ms: number): string => {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
};

const baseName = (dir: string): string => dir.split("/").filter(Boolean).pop() ?? dir;

const toOpen = (session: { id: string; title: string; directory: string; time: { updated: number } }): DubzOpenSession => ({
  id: session.id,
  title: session.title,
  updated: session.time.updated,
  directory: session.directory,
});

/**
 * The session suggestion: one row — a big pill (most related session) and a
 * number pill (sessions in the file's worktree), filling the width. SwiftUI
 * glass so it renders inside the window.
 */
export const DubzSessionRow = (props: {
  readonly file: FileRef;
  readonly onOpen: (session: DubzOpenSession) => void;
  readonly onList: () => void;
}): React.ReactElement | null => {
  const textColors = useTextColors();
  const { width } = useWindowDimensions();
  const { related, all } = React.useMemo(() => sessionsForFile(cachedSessionsNow(), props.file.path), [props.file.path]);
  const top = related[0] ?? all[0];
  if (top === undefined) return null;
  const rowWidth = width - AREA_PADDING * 2;
  const bigWidth = Math.max(100, rowWidth - NUMBER_WIDTH - ROW_GAP);
  return (
    <Host style={{ width: rowWidth, height: ROW_HEIGHT }} ignoreSafeArea="all">
      <HStack spacing={ROW_GAP}>
        <HStack
          spacing={8}
          modifiers={[
            padding({ horizontal: 16 }),
            frame({ width: bigWidth, height: ROW_HEIGHT, alignment: "leading" }),
            glassEffect({ glass: { variant: "regular" }, shape: "capsule" }),
            contentShape(shapes.capsule()),
            onTapGesture(() => props.onOpen(toOpen(top))),
          ]}
        >
          <Image systemName="bubble.left.and.bubble.right.fill" size={14} color={textColors.secondaryLabel} />
          <UIText modifiers={[font({ size: 16, weight: "semibold" }), foregroundStyle(textColors.label), lineLimit(1)]}>{top.title}</UIText>
        </HStack>
        <HStack
          modifiers={[
            frame({ width: NUMBER_WIDTH, height: ROW_HEIGHT, alignment: "center" }),
            glassEffect({ glass: { variant: "regular" }, shape: "capsule" }),
            contentShape(shapes.capsule()),
            onTapGesture(props.onList),
          ]}
        >
          <UIText modifiers={[font({ size: 17, weight: "semibold" }), foregroundStyle(textColors.secondaryLabel)]}>{String(related.length)}</UIText>
        </HStack>
      </HStack>
    </Host>
  );
};

/** The full list of sessions for a file — related first, then by recency. */
export const DubzSessionList = (props: {
  readonly file: FileRef;
  readonly onOpen: (session: DubzOpenSession) => void;
  readonly onBack: () => void;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const { colors: themeColors } = useTheme();
  const { all } = React.useMemo(() => sessionsForFile(cachedSessionsNow(), props.file.path), [props.file.path]);
  return (
    <View style={styles.sub}>
      <Header title="Sessions" onBack={props.onBack} tint={themeColors.secondary} />
      <ScrollView style={styles.fill} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        {all.map((session) => (
          <Pressable
            key={session.id}
            style={styles.listRow}
            onPress={() => props.onOpen(toOpen(session))}
            accessibilityRole="button"
            accessibilityLabel={`Open session ${session.title}`}
          >
            <View style={styles.listText}>
              <Text style={styles.listTitle} numberOfLines={1}>
                {session.title}
              </Text>
              <Text style={styles.listMeta} numberOfLines={1}>
                {baseName(session.directory)}
              </Text>
            </View>
            <Text style={styles.listTime}>{relativeTime(session.time.updated)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
};

/** A session open in the Dubz window: the real transcript (pinned to the
 * bottom, newest in view), a back chip, and a full-screen button to the proper
 * session page (where the 3-dot menu would be). */
export const DubzSessionView = (props: {
  readonly session: DubzOpenSession;
  readonly onBack: () => void;
  readonly onFullScreen: (sessionID: string) => void;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const { colors: themeColors } = useTheme();
  const { client } = useAppContext();
  const transcript = useSessionPreview(client, props.session.id, props.session.updated, true);
  const scrollRef = React.useRef<ScrollView>(null);
  const messages = React.useMemo(
    () =>
      transcript === undefined
        ? []
        : transcript.order.flatMap((id) => {
            const message = transcript.messages.get(id);
            return message === undefined ? [] : [chatMessageOfV1(message)];
          }),
    [transcript],
  );
  return (
    <View style={styles.sub}>
      <Header
        title={props.session.title}
        onBack={props.onBack}
        tint={themeColors.secondary}
        right={
          <Pressable onPress={() => props.onFullScreen(props.session.id)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Open full screen">
            <SystemIcon name="arrow.up.left.and.arrow.down.right" size={16} color={themeColors.secondary} />
          </Pressable>
        }
      />
      <CollapsiblePartsProvider newestID={undefined}>
        <ScrollView
          ref={scrollRef}
          style={styles.fill}
          contentContainerStyle={styles.transcriptContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {transcript === undefined ? (
            <Text style={styles.loading}>Loading…</Text>
          ) : (
            messages.map((message) => <MessageBubble key={message.id} message={message} noMenu />)
          )}
        </ScrollView>
      </CollapsiblePartsProvider>
    </View>
  );
};

/** A sub-page header: back chip to the main Dubz, title, and an optional right. */
const Header = (props: { readonly title: string; readonly onBack: () => void; readonly tint: string; readonly right?: React.ReactNode }): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.header}>
      <Pressable onPress={props.onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back to Dubz" style={styles.backChip}>
        <SystemIcon name="chevron.left" size={15} color={props.tint} />
        <Text style={[styles.backLabel, { color: props.tint }]}>Dubz</Text>
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {props.title}
      </Text>
      {props.right ?? null}
    </View>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    sub: {
      flex: 1,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: AREA_PADDING,
      paddingBottom: 8,
    },
    backChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
    },
    backLabel: {
      fontSize: 15,
      fontWeight: "600",
    },
    headerTitle: {
      flex: 1,
      color: text.label,
      fontSize: 15,
      fontWeight: "600",
    },
    fill: {
      flex: 1,
    },
    listContent: {
      paddingHorizontal: AREA_PADDING,
      paddingBottom: 12,
    },
    listRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 10,
    },
    listText: {
      flex: 1,
    },
    listTitle: {
      color: text.label,
      fontSize: 15,
      fontWeight: "600",
    },
    listMeta: {
      color: text.secondaryLabel,
      fontSize: 12,
      marginTop: 1,
    },
    listTime: {
      color: text.secondaryLabel,
      fontSize: 13,
    },
    transcriptContent: {
      paddingHorizontal: AREA_PADDING,
      paddingBottom: 12,
    },
    loading: {
      color: text.secondaryLabel,
      fontSize: 14,
    },
  });
