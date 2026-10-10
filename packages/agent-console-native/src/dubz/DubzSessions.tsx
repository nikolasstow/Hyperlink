/**
 * Sessions inside the Dubz window. On a page that publishes an editable document,
 * Dubz shows one session row: a big pill with the most related session and a
 * number pill with how many sessions live in that file's worktree. Tap the big
 * pill to open that session; tap the number for the full list (related first,
 * then by recency). A session opens as the real chat — the actual MessageBubble
 * transcript — in the Dubz window, with a full-screen button to pop out to the
 * proper session page.
 *
 * First cut: the transcript is the kept/preview conversation (not yet live) and
 * continuing the conversation rides the Dubz pill — both next.
 *
 * @internal
 */
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from "react-native";
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
}

const relativeTime = (ms: number): string => {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
};

const baseName = (dir: string): string => dir.split("/").filter(Boolean).pop() ?? dir;

/**
 * The session suggestion: one row, the big pill (most related session) and the
 * number pill (sessions in the file's worktree). Together they fill the width.
 */
export const DubzSessionRow = (props: {
  readonly file: FileRef;
  readonly onOpen: (session: DubzOpenSession) => void;
  readonly onList: () => void;
}): React.ReactElement | null => {
  const styles = useThemedStyles(makeStyles);
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const { related, all } = React.useMemo(() => sessionsForFile(cachedSessionsNow(), props.file.path), [props.file.path]);
  const top = related[0] ?? all[0];
  if (top === undefined) return null;
  return (
    <View style={styles.row}>
      <Pressable
        style={styles.bigWrap}
        onPress={() => props.onOpen({ id: top.id, title: top.title, updated: top.time.updated })}
        accessibilityRole="button"
        accessibilityLabel={`Open session ${top.title}`}
      >
        <GlassView style={styles.bigPill} glassEffectStyle="regular" colorScheme={scheme}>
          <SystemIcon name="bubble.left.and.bubble.right.fill" size={14} color={styles.countText.color} />
          <Text style={styles.bigLabel} numberOfLines={1}>
            {top.title}
          </Text>
        </GlassView>
      </Pressable>
      <Pressable onPress={props.onList} accessibilityRole="button" accessibilityLabel={`All sessions in this worktree: ${related.length}`}>
        <GlassView style={styles.countPill} glassEffectStyle="regular" colorScheme={scheme}>
          <Text style={styles.countText}>{related.length}</Text>
        </GlassView>
      </Pressable>
    </View>
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
            onPress={() => props.onOpen({ id: session.id, title: session.title, updated: session.time.updated })}
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

/** A session open in the Dubz window: the real transcript, a back chip, and a
 * full-screen button to the proper session page (where the 3-dot menu would be). */
export const DubzSessionView = (props: {
  readonly session: DubzOpenSession;
  readonly onBack: () => void;
  readonly onFullScreen: (sessionID: string) => void;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const { colors: themeColors } = useTheme();
  const { client } = useAppContext();
  const transcript = useSessionPreview(client, props.session.id, props.session.updated, true);
  const messages = React.useMemo(
    () => (transcript === undefined ? [] : transcript.order.flatMap((id) => {
      const message = transcript.messages.get(id);
      return message === undefined ? [] : [chatMessageOfV1(message)];
    })),
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
        <ScrollView style={styles.fill} contentContainerStyle={styles.transcriptContent} showsVerticalScrollIndicator={false}>
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

const BIG_HEIGHT = 44;

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    bigWrap: {
      flex: 1,
    },
    bigPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      height: BIG_HEIGHT,
      paddingHorizontal: 16,
      borderRadius: BIG_HEIGHT / 2,
    },
    bigLabel: {
      flex: 1,
      color: text.label,
      fontSize: 16,
      fontWeight: "600",
    },
    countPill: {
      alignItems: "center",
      justifyContent: "center",
      height: BIG_HEIGHT,
      minWidth: 52,
      paddingHorizontal: 16,
      borderRadius: BIG_HEIGHT / 2,
    },
    countText: {
      color: text.secondaryLabel,
      fontSize: 17,
      fontWeight: "600",
    },
    sub: {
      flex: 1,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
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
      paddingBottom: 12,
    },
    loading: {
      color: text.secondaryLabel,
      fontSize: 14,
    },
  });
