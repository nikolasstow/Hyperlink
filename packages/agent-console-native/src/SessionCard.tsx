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
import { background, cornerRadius, font, foregroundStyle, frame, glassEffect, lineLimit, onTapGesture, padding } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { Pressable, StyleSheet, useWindowDimensions } from "react-native";
import Swipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { Easing, FadeIn, LinearTransition, runOnJS, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { ChatPreview } from "./ChatPreview";
import type { OpencodeClient } from "./client";
import { colors } from "./colors";
import { lastMessageSummary, useSessionPreview } from "./sessionPreview";
import { takeReturning } from "./sessionArchive";
import { SystemIcon } from "./SystemIcon";
import { useCardTint, useTextColors, useTheme } from "./theme";
import { usePreloadConversation } from "./conversations/usePreloadConversation";

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

/** The swipe actions, as Messages draws them: circles beside the card, its
 * sizes (measured from Messages). */
const CIRCLE = 46;
const CIRCLE_GAP = 10;
const ICON = 18;
/** Room the revealed actions take: both circles, the gaps around them. */
const ACTIONS_WIDTH = CIRCLE * 2 + CIRCLE_GAP * 3;

/**
 * What swiping a session left reveals (it reveals only; nothing happens until
 * a tap), as in Messages' Mute and Delete: Mute (indigo), and in the red
 * circle, Archive (Unarchive on the Archived page). Delete is in the menu.
 */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** How far into the reveal each circle grows in: Archive (the nearer) over
 * the first part, Mute over the last, overlapping a little. */
const ARCHIVE_SPAN: readonly [number, number] = [0, 0.55];
const MUTE_SPAN: readonly [number, number] = [0.45, 1];
/** A circle's size before it grows in. */
const CIRCLE_START_SCALE = 0.1;

/** How far the row opens: the actions' width less the card gutter they sit
 * under. The swipe's progress is 1 there. */
const OPEN_WIDTH = ACTIONS_WIDTH - CARD_GUTTER;

/** A circle's growth through its span of the reveal, from the swipe's progress
 * (1 fully open): it sits at its final place throughout, and only grows and
 * fades in there, from a tenth of its size and nothing. */
const useRevealStyle = (progress: SharedValue<number>, [from, to]: readonly [number, number]) =>
  useAnimatedStyle(() => {
    const raw = (progress.value - from) / (to - from);
    const p = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    return {
      opacity: p,
      transform: [{ scale: CIRCLE_START_SCALE + (1 - CIRCLE_START_SCALE) * p }],
    };
  });

const SwipeActions = (props: {
  /** How far the row is open: 0 closed, 1 fully open, beyond when pulled past. */
  readonly progress: SharedValue<number>;
  readonly archived: boolean;
  readonly muted: boolean;
  readonly onMute: () => void;
  readonly onArchive: () => void;
}): React.ReactElement => {
  const muteStyle = useRevealStyle(props.progress, MUTE_SPAN);
  const archiveStyle = useRevealStyle(props.progress, ARCHIVE_SPAN);
  // Pulled past fully open: Archive stretches toward the card into a capsule,
  // filling the extra room, and the actions widen with it (they sit at the
  // right, so they grow leftward and Mute stays by the card's edge).
  const extra = useDerivedValue(() => Math.max(0, props.progress.value - 1) * OPEN_WIDTH);
  const actionsStretch = useAnimatedStyle(() => ({ width: ACTIONS_WIDTH + extra.value }));
  const archiveStretch = useAnimatedStyle(() => ({ width: CIRCLE + extra.value }));
  return (
    <Animated.View style={[styles.actions, actionsStretch]}>
      <Animated.View style={muteStyle}>
        <Pressable style={[styles.circle, styles.muteCircle]} onPress={props.onMute} accessibilityRole="button" accessibilityLabel={props.muted ? "Unmute" : "Mute"}>
          <SystemIcon name={props.muted ? "bell.fill" : "bell.slash.fill"} size={ICON} color="#FFFFFF" />
        </Pressable>
      </Animated.View>
      <Animated.View style={archiveStyle}>
        <AnimatedPressable
          style={[styles.circle, styles.archiveCircle, styles.archiveStretchable, archiveStretch]}
          onPress={props.onArchive}
          accessibilityRole="button"
          accessibilityLabel={props.archived ? "Unarchive" : "Archive"}
        >
          <SystemIcon name={props.archived ? "tray.and.arrow.up.fill" : "archivebox.fill"} size={ICON} color="#FFFFFF" />
        </AnimatedPressable>
      </Animated.View>
    </Animated.View>
  );
};

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
}): React.ReactElement => {
  const textColors = useTextColors();
  // Slightly darker on a light background, lighter on a dark one.
  const tint = useCardTint();
  return (
  <VStack
    alignment="leading"
    spacing={8}
    modifiers={[padding({ all: 14 }), frame({ width: props.width, alignment: "leading" }), glassEffect({ glass: { variant: "regular", tint }, shape: "roundedRectangle", cornerRadius: 14 })]}
  >
    <HStack spacing={7} alignment="center">
      {props.unread ? <Circle modifiers={[frame({ width: 8, height: 8 }), foregroundStyle(props.unreadColor)]} /> : null}
      <UIText modifiers={[font({ size: 17, weight: "semibold" }), foregroundStyle(textColors.label), lineLimit(2)]}>{props.title}</UIText>
      {/* Muted: the bell Messages shows beside a muted conversation. */}
      {props.muted ? <Image systemName="bell.slash.fill" size={12} color={textColors.secondaryLabel} /> : null}
    </HStack>
    {props.repo !== undefined || props.worktree !== undefined ? (
      <HStack spacing={6} alignment="center">
        {props.repo !== undefined ? (
          <UIText modifiers={[font({ size: 11, weight: "semibold" }), foregroundStyle(textColors.secondaryLabel), padding({ horizontal: 8, vertical: 2 }), background(colors.fillBackground), cornerRadius(999)]}>{props.repo}</UIText>
        ) : null}
        {props.worktree !== undefined ? (
          <UIText modifiers={[font({ size: 11, weight: "semibold" }), foregroundStyle(colors.tint), padding({ horizontal: 8, vertical: 2 }), background(colors.fillBackground), cornerRadius(999)]}>{props.worktree}</UIText>
        ) : null}
      </HStack>
    ) : null}
    {props.summary !== undefined ? (
      <UIText modifiers={[font({ size: 13 }), foregroundStyle(textColors.secondaryLabel), lineLimit(2)]}>{props.summary}</UIText>
    ) : null}
    <UIText modifiers={[font({ size: 11 }), foregroundStyle(textColors.secondaryLabel)]}>{props.meta}</UIText>
  </VStack>
  );
};

export const SessionCard = (props: SessionCardProps): React.ReactElement => {
  // It opens a chat: that chat's newest messages are kept before the tap.
  usePreloadConversation(props.sessionId, props.updatedAt);
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
      // The swipeable clips to itself by default, which cut the card's glass
      // shadow off above and below; the row spans the screen, and the swipe
      // actions keep their own clip.
      containerStyle={styles.swipeable}
      friction={1.4}
      // Pulling past open stretches Archive (SwipeActions); release springs
      // back to open.
      overshootRight
      rightThreshold={ACTIONS_WIDTH / 3}
      renderRightActions={(progress) => (
        <SwipeActions
          progress={progress}
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
  swipeable: {
    overflow: "visible",
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
  // Its icon keeps its place (a circle's centre) as it stretches, on the
  // capsule's leading side.
  archiveStretchable: {
    alignItems: "flex-start",
    paddingLeft: (CIRCLE - ICON) / 2,
  },
});
