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
import { Button, Circle, ContextMenu, Host, HStack, Image, RNHostView, Section, Text as UIText, VStack } from "@expo/ui/swift-ui";
import { background, cornerRadius, font, foregroundStyle, frame, lineLimit, onTapGesture, padding } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Swipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { Easing, FadeIn, LinearTransition, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { ChatPreview } from "./ChatPreview";
import type { OpencodeClient } from "./client";
import { colors } from "./colors";
import { lastMessageSummary, useSessionPreview } from "./sessionPreview";
import { takeReturning } from "./sessionArchive";
import { SystemIcon } from "./SystemIcon";
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
  readonly onDelete: () => void;
  /** Put the session away (swipe left and tap, or the menu); the list
   * leaves it out. On the Archived page (`archived`), take it back out. */
  readonly onArchive: () => void;
  /** An archived session (the Archived page): its action is Unarchive. */
  readonly archived?: boolean;
  /** Muted: it sends no notifications, and its card shows the muted bell. */
  readonly muted: boolean;
  /** Mute the session, or unmute a muted one. */
  readonly onMute: () => void;
};

/** The swipe actions, as Messages draws them: circles beside the card. */
const CIRCLE = 58;
const CIRCLE_GAP = 12;
/** Room the revealed actions take: both circles, the gaps around them. */
const ACTIONS_WIDTH = CIRCLE * 2 + CIRCLE_GAP * 3;

/**
 * What swiping a session left reveals (it reveals only; nothing happens until
 * a tap), as in Messages' Mute and Delete: Mute (indigo), and in the red
 * circle, Archive (Unarchive on the Archived page). Delete is in the menu.
 */
const SwipeActions = (props: {
  readonly archived: boolean;
  readonly muted: boolean;
  readonly onMute: () => void;
  readonly onArchive: () => void;
}): React.ReactElement => (
  <View style={styles.actions}>
    <Pressable style={[styles.circle, styles.muteCircle]} onPress={props.onMute} accessibilityRole="button" accessibilityLabel={props.muted ? "Unmute" : "Mute"}>
      <SystemIcon name={props.muted ? "bell.fill" : "bell.slash.fill"} size={22} color="#FFFFFF" />
    </Pressable>
    <Pressable
      style={[styles.circle, styles.archiveCircle]}
      onPress={props.onArchive}
      accessibilityRole="button"
      accessibilityLabel={props.archived ? "Unarchive" : "Archive"}
    >
      <SystemIcon name={props.archived ? "tray.and.arrow.up.fill" : "archivebox.fill"} size={22} color="#FFFFFF" />
    </Pressable>
  </View>
);

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
  readonly muted: boolean;
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
      {/* Muted: the bell Messages shows beside a muted conversation. */}
      {props.muted ? <Image systemName="bell.slash.fill" size={12} color={colors.secondaryLabel} /> : null}
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

  // Archiving: the row slides off to the left, then the session leaves the
  // list, and the rows below glide up into its place (the lists' layout
  // transitions). Undo brings it back: its card fades in as they make room.
  const { onArchive, onMute } = props;
  const swipeable = React.useRef<SwipeableMethods>(null);
  const slide = useSharedValue(0);
  const leaving = React.useRef(false);
  const archive = React.useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    slide.value = withTiming(1, { duration: SLIDE_MS, easing: Easing.in(Easing.cubic) }, (slid) => {
      if (slid === true) runOnJS(onArchive)();
    });
  }, [onArchive, slide]);
  const leave = useAnimatedStyle(() => (slide.value === 0 ? {} : { transform: [{ translateX: -screenWidth * slide.value }] }));
  // A card arriving in the list (Undo, or newly archived) fades in, once.
  const [arriving] = React.useState(() => takeReturning(props.sessionId));

  return (
    <Animated.View
      style={[styles.row, leave]}
      // Moves smoothly when rows around it come or go (in a list that is not
      // a FlatList; a FlatList animates its cells: itemLayoutAnimation).
      layout={LinearTransition.duration(LAYOUT_MS)}
      {...(arriving ? { entering: FadeIn.duration(LAYOUT_MS) } : {})}
    >
    <Swipeable
      ref={swipeable}
      friction={1.4}
      overshootRight={false}
      rightThreshold={ACTIONS_WIDTH / 3}
      renderRightActions={() => (
        <SwipeActions
          archived={props.archived === true}
          muted={props.muted}
          onMute={() => {
            swipeable.current?.close();
            onMute();
          }}
          onArchive={archive}
        />
      )}
    >
    <Host
      style={{ marginHorizontal: CARD_GUTTER }}
      matchContents={{ vertical: true, horizontal: false }}
      // Ignores the safe area: otherwise SwiftUI pads it as it scrolls under
      // the header or the home indicator, so it stretches and shrinks while
      // scrolling and overlaps its neighbours.
      ignoreSafeArea="all"
    >
      <ContextMenu>
        <ContextMenu.Items>
          <Button label="Open" systemImage="bubble.left.and.bubble.right" onPress={props.onOpen} />
          <Button label="Rename" systemImage="pencil" onPress={props.onRename} />
          <Button label={props.muted ? "Unmute" : "Mute"} systemImage={props.muted ? "bell" : "bell.slash"} onPress={props.onMute} />
          {props.archived === true ? (
            <Button label="Unarchive" systemImage="tray.and.arrow.up" onPress={archive} />
          ) : (
            <Button label="Archive" systemImage="archivebox" onPress={archive} />
          )}
          <Section>
            {props.running ? <Button label="Stop" role="destructive" systemImage="stop.fill" onPress={props.onStop} /> : null}
            <Button label="Delete" role="destructive" systemImage="trash" onPress={props.onDelete} />
          </Section>
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
              muted={props.muted}
              summary={summary === undefined ? undefined : summaryLabel(summary.role, summary.text)}
            />
          </VStack>
        </ContextMenu.Trigger>
      </ContextMenu>
    </Host>
    </Swipeable>
    </Animated.View>
  );
};

/** How the row leaves when archived (sliding off), and how rows move and
 * arrive around it. */
const SLIDE_MS = 220;
export const LAYOUT_MS = 260;
/** Space under each card. */
const ROW_GAP = 10;

const styles = StyleSheet.create({
  row: {
    marginBottom: ROW_GAP,
  },
  // The circles sit centred beside the card, inside its right gutter.
  actions: {
    width: ACTIONS_WIDTH,
    marginLeft: -CARD_GUTTER,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: CIRCLE_GAP,
  },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  muteCircle: {
    backgroundColor: colors.archive,
  },
  archiveCircle: {
    backgroundColor: colors.destructive,
  },
});
