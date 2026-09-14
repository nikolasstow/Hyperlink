/**
 * One session row for the plain (non-glass) native lists — the repo screen and
 * the "See all" list. Title, an unread dot, a worktree badge, a summary of the
 * latest message (loaded cache-first via the shared preview cache, same source
 * as Home's cards), and the relative time.
 *
 * A component, not an inline render function, so it can hold the per-session
 * summary hook. Home uses the richer SwiftUI `SessionCard` (context menu +
 * preview); this is the lightweight RN counterpart shared by the other lists.
 *
 * @internal
 */
import * as React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { Session } from "@opencode-ai/sdk";
import type { OpencodeClient } from "./client";
import { colors } from "./colors";
import { lastMessageSummary, useSessionPreview } from "./sessionPreview";
import { relativeTime } from "./time";

export const SessionRow = (props: {
  readonly client: OpencodeClient;
  readonly session: Session;
  readonly worktree?: string;
  readonly unread: boolean;
  /** Whether to lazily load the summary (e.g. only while the screen is focused). */
  readonly previewEnabled: boolean;
  readonly onOpen: () => void;
}): React.ReactElement => {
  const transcript = useSessionPreview(props.client, props.session.id, props.session.time.updated, props.previewEnabled);
  const summary = lastMessageSummary(transcript);

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={props.onOpen}>
      {props.unread ? <View style={styles.indicator} /> : null}
      <Text style={[styles.title, props.unread && styles.titleUnread]} numberOfLines={2}>
        {props.session.title}
      </Text>
      {props.worktree !== undefined ? <Text style={styles.badge}>{props.worktree}</Text> : null}
      {summary !== undefined ? (
        <Text style={styles.summary} numberOfLines={2}>
          {summary.role === "user" ? `You: ${summary.text}` : summary.text}
        </Text>
      ) : null}
      <Text style={styles.meta}>{relativeTime(props.session.time.updated)}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 10,
    gap: 6,
  },
  indicator: {
    position: "absolute",
    top: 16,
    right: 14,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: colors.themeSecondary,
  },
  title: {
    color: colors.label,
    fontSize: 16,
    fontWeight: "500",
    paddingRight: 16,
  },
  titleUnread: {
    fontWeight: "700",
  },
  badge: {
    alignSelf: "flex-start",
    color: colors.tint,
    backgroundColor: colors.accentTint,
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: "hidden",
  },
  summary: {
    color: colors.secondaryLabel,
    fontSize: 13,
    marginTop: 2,
  },
  meta: {
    color: colors.secondaryLabel,
    fontSize: 13,
  },
});
