/**
 * Sessions inside the Dubz window. On a page that publishes a file (an
 * EditableDocument entry), Dubz shows session chips; tapping one opens that
 * session *in the Dubz window* as a sub-page — a read-only transcript with a
 * back chip to the main Dubz view — so you can read where a session left off
 * while the file stays behind.
 *
 * First cut: the chips are recent sessions and the transcript is read-only.
 * Next: filter the chips to the sessions that actually touched the file, and a
 * composer to continue the conversation from here.
 *
 * @internal
 */
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from "react-native";
import { useAppContext } from "../AppContext";
import { cachedSessionsNow } from "../sessionCache";
import type { SessionSummary } from "../sessions/sessionList";
import { useSessionPreview } from "../sessionPreview";
import { SystemIcon } from "../SystemIcon";
import { type TextColors, useTextColors, useThemedStyles, useTheme } from "../theme";
import type { TranscriptMessage } from "../useSessionStream";

/** The session a chip opens, as the sub-page needs it. */
export interface DubzOpenSession {
  readonly id: string;
  readonly title: string;
  readonly updated: number;
}

/** How many recent sessions to offer as chips. */
const CHIP_LIMIT = 6;

const relativeTime = (ms: number): string => {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
};

/** The readable text of a transcript message: its text parts, skipping the
 * synthetic ones (attached file contents) — what you'd glance at to recall it. */
const messageText = (message: TranscriptMessage): string =>
  [...message.parts.values()]
    .filter((part) => part.type === "text" && part.synthetic !== true)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();

/** The session chips — recent sessions, each a glass pill. */
export const DubzSessionChips = (props: { readonly onOpen: (session: DubzOpenSession) => void }): React.ReactElement | null => {
  const styles = useThemedStyles(makeStyles);
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const sessions = React.useMemo(() => [...cachedSessionsNow()].sort((a, b) => b.time.updated - a.time.updated).slice(0, CHIP_LIMIT), []);
  if (sessions.length === 0) return null;
  return (
    <View style={styles.chipRow}>
      {sessions.map((session: SessionSummary) => (
        <Pressable
          key={session.id}
          onPress={() => props.onOpen({ id: session.id, title: session.title, updated: session.time.updated })}
          accessibilityRole="button"
          accessibilityLabel={`Open session ${session.title}`}
        >
          <GlassView style={styles.chip} glassEffectStyle="regular" colorScheme={scheme}>
            <SystemIcon name="bubble.left.and.bubble.right" size={12} color={styles.chipTime.color} />
            <Text style={styles.chipTitle} numberOfLines={1}>
              {session.title}
            </Text>
            <Text style={styles.chipTime}>{relativeTime(session.time.updated)}</Text>
          </GlassView>
        </Pressable>
      ))}
    </View>
  );
};

/** A session open inside the Dubz window: a back chip, then its transcript. */
export const DubzSessionView = (props: { readonly session: DubzOpenSession; readonly onBack: () => void }): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const { colors: themeColors } = useTheme();
  const { client } = useAppContext();
  const transcript = useSessionPreview(client, props.session.id, props.session.updated, true);

  return (
    <View style={styles.sessionArea}>
      <View style={styles.sessionHeader}>
        <Pressable onPress={props.onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back to Dubz" style={styles.backChip}>
          <SystemIcon name="chevron.left" size={15} color={themeColors.secondary} />
          <Text style={[styles.backLabel, { color: themeColors.secondary }]}>Dubz</Text>
        </Pressable>
        <Text style={styles.sessionTitle} numberOfLines={1}>
          {props.session.title}
        </Text>
      </View>
      <ScrollView style={styles.transcript} contentContainerStyle={styles.transcriptContent} showsVerticalScrollIndicator={false}>
        {transcript === undefined ? (
          <Text style={styles.empty}>Loading…</Text>
        ) : (
          transcript.order.map((id) => {
            const message = transcript.messages.get(id);
            if (message === undefined) return null;
            const text = messageText(message);
            if (text === "") return null;
            const isUser = message.role === "user";
            return (
              <View key={id} style={[styles.row, isUser ? styles.rowUser : styles.rowAgent]}>
                <Text style={[styles.message, isUser ? styles.userMessage : styles.agentMessage]}>{text}</Text>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    chipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      paddingHorizontal: 2,
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      height: 34,
      maxWidth: 220,
      paddingHorizontal: 12,
      borderRadius: 17,
    },
    chipTitle: {
      color: text.label,
      fontSize: 14,
      fontWeight: "600",
      flexShrink: 1,
    },
    chipTime: {
      color: text.secondaryLabel,
      fontSize: 12,
    },
    sessionArea: {
      flex: 1,
    },
    sessionHeader: {
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
    sessionTitle: {
      flex: 1,
      color: text.label,
      fontSize: 15,
      fontWeight: "600",
    },
    transcript: {
      flex: 1,
    },
    transcriptContent: {
      gap: 10,
      paddingBottom: 12,
    },
    row: {
      maxWidth: "88%",
    },
    rowUser: {
      alignSelf: "flex-end",
    },
    rowAgent: {
      alignSelf: "flex-start",
    },
    message: {
      fontSize: 14,
      lineHeight: 20,
    },
    userMessage: {
      color: text.label,
    },
    agentMessage: {
      color: text.label,
    },
    empty: {
      color: text.secondaryLabel,
      fontSize: 14,
    },
  });
