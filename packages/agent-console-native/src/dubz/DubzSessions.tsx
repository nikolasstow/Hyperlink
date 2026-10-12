/**
 * The session row Dubz shows on a page that publishes an editable document: one
 * row, all SwiftUI (so nothing React renders inside the window's glass) — a big
 * pill with the most related session and a number pill with how many sessions
 * live in that file's worktree, stretched to fit the window. Tapping opens the
 * session's proper full-screen page.
 *
 * The in-window session view was removed: it pulled heavy React (a live
 * transcript) into the glass window and destabilised it. It comes back later as
 * native, once the row is solid.
 *
 * @internal
 */
import { Host, HStack, Image, ScrollView, Spacer, Text as UIText, VStack } from "@expo/ui/swift-ui";
import { Animation, animation, contentShape, font, foregroundStyle, frame, glassEffect, lineLimit, offset, onTapGesture, padding, shapes } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { useAppContext } from "../AppContext";
import type { FileRef } from "../dubzSuggestions";
import { cachedSessionsNow } from "../sessionCache";
import { useSessionPreview } from "../sessionPreview";
import { useTextColors } from "../theme";
import type { TranscriptMessage } from "../useSessionStream";
import { sessionsForFile } from "./sessionsForFile";

/** The session a row opens. */
export interface DubzOpenSession {
  readonly id: string;
  readonly title: string;
  readonly updated: number;
}

/** The readable text of a transcript message: its text parts, skipping the
 * synthetic ones (attached file contents). */
const messageText = (message: TranscriptMessage): string =>
  [...message.parts.values()]
    .filter((part) => part.type === "text" && part.synthetic !== true)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();

const ROW_HEIGHT = 44;
const NUMBER_WIDTH = 52;
const ROW_GAP = 8;
/** The window's side margin (BarWindow) plus the suggestions' padding, per side:
 * the row stretches to exactly this, so it never overflows the window. */
const WINDOW_SIDE = 12 + 16;
/** The push transition — SwiftUI's own animation (UI thread), no Reanimated. */
const SLIDE = Animation.easeInOut({ duration: 0.28 });
/** Match SLIDE's duration (ms) for timing an unmount after a slide-out. */
export const SLIDE_MS = 280;

/**
 * The session suggestion: one native row — a big pill (most related session) and
 * a number pill (sessions in the file's worktree), filling the window width.
 */
export const DubzSessionRow = (props: {
  readonly file: FileRef;
  readonly onOpen: (session: DubzOpenSession) => void;
  /** True while a page is open over the window: the row slides out to the left. */
  readonly shifted?: boolean;
}): React.ReactElement | null => {
  const textColors = useTextColors();
  const { width } = useWindowDimensions();
  const { related, all } = React.useMemo(() => sessionsForFile(cachedSessionsNow(), props.file.path), [props.file.path]);
  const top = related[0] ?? all[0];
  if (top === undefined) return null;
  const rowWidth = width - WINDOW_SIDE * 2;
  const bigWidth = Math.max(100, rowWidth - NUMBER_WIDTH - ROW_GAP);
  const shifted = props.shifted === true;
  const open = (): void => props.onOpen({ id: top.id, title: top.title, updated: top.time.updated });
  return (
    <Host style={{ width: rowWidth, height: ROW_HEIGHT }} ignoreSafeArea="all">
      <HStack spacing={ROW_GAP} modifiers={[offset({ x: shifted ? -width : 0 }), animation(SLIDE, shifted)]}>
        <HStack
          spacing={8}
          modifiers={[
            padding({ horizontal: 16 }),
            frame({ width: bigWidth, height: ROW_HEIGHT, alignment: "leading" }),
            glassEffect({ glass: { variant: "regular" }, shape: "capsule" }),
            contentShape(shapes.capsule()),
            onTapGesture(open),
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
            onTapGesture(open),
          ]}
        >
          <UIText modifiers={[font({ size: 17, weight: "semibold" }), foregroundStyle(textColors.secondaryLabel)]}>{String(related.length)}</UIText>
        </HStack>
      </HStack>
    </Host>
  );
};

const BUTTON = 36;
/** Space the title clears for the window's persistent top-left back button. */
const BACK_INSET = BUTTON + 10;

/** The glass back button that stays at the Dubz window's top-left: on a page it
 * goes back, at Dubz home it closes Dubz. Shared so both read identically. */
export const DubzTopBack = (props: { readonly onPress: () => void }): React.ReactElement => {
  const textColors = useTextColors();
  return (
    <Host style={{ width: BUTTON, height: BUTTON }} ignoreSafeArea="all">
      <HStack
        modifiers={[
          frame({ width: BUTTON, height: BUTTON, alignment: "center" }),
          glassEffect({ glass: { variant: "regular", interactive: true }, shape: "capsule" }),
          contentShape(shapes.capsule()),
          onTapGesture(props.onPress),
        ]}
      >
        <Image systemName="chevron.left" size={15} color={textColors.label} />
      </HStack>
    </Host>
  );
};

/** A large value standing in for SwiftUI's `.infinity` so a frame fills. */
const FILL = 100000;

/**
 * A session open inside the Dubz window, rendered natively: a glass header (the
 * title, clearing the window's persistent back button, and a full-screen button
 * to the proper page) over the transcript — SwiftUI `Text` rows in a native
 * `ScrollView`, fed by the kept/preview conversation. Nothing React renders in
 * the glass, so the window stays stable. The whole page slides in natively
 * (offset + animation) with `shifted`.
 */
export const DubzSessionPlaceholder = (props: {
  readonly session: DubzOpenSession;
  readonly onFullScreen: () => void;
  /** Drives the native slide-in from the right (false = off-screen right). */
  readonly shifted?: boolean;
}): React.ReactElement => {
  const textColors = useTextColors();
  const { width } = useWindowDimensions();
  const { client } = useAppContext();
  const pageWidth = width - WINDOW_SIDE * 2;
  const shifted = props.shifted === true;
  const transcript = useSessionPreview(client, props.session.id, props.session.updated, true);
  const messages = React.useMemo(
    () =>
      transcript === undefined
        ? []
        : transcript.order.flatMap((id) => {
            const message = transcript.messages.get(id);
            if (message === undefined) return [];
            const text = messageText(message);
            return text === "" ? [] : [{ id, role: message.role, text }];
          }),
    [transcript],
  );
  return (
    <View style={styles.page} pointerEvents={shifted ? "auto" : "none"}>
      <Host style={{ flex: 1 }} ignoreSafeArea="all">
        <VStack alignment="leading" spacing={10} modifiers={[frame({ maxWidth: FILL, maxHeight: FILL, alignment: "topLeading" }), offset({ x: shifted ? 0 : width }), animation(SLIDE, shifted)]}>
          <HStack spacing={10} alignment="center" modifiers={[frame({ width: pageWidth, height: BUTTON })]}>
            <UIText modifiers={[padding({ leading: BACK_INSET }), font({ size: 16, weight: "semibold" }), foregroundStyle(textColors.label), lineLimit(1)]}>{props.session.title}</UIText>
            <Spacer />
            <HStack
              modifiers={[
                frame({ width: BUTTON, height: BUTTON, alignment: "center" }),
                glassEffect({ glass: { variant: "regular", interactive: true }, shape: "capsule" }),
                contentShape(shapes.capsule()),
                onTapGesture(props.onFullScreen),
              ]}
            >
              <Image systemName="arrow.up.left.and.arrow.down.right" size={14} color={textColors.label} />
            </HStack>
          </HStack>
          <ScrollView showsIndicators={false} modifiers={[frame({ maxWidth: FILL, maxHeight: FILL, alignment: "topLeading" })]}>
            <VStack alignment="leading" spacing={12} modifiers={[frame({ width: pageWidth, alignment: "leading" })]}>
              {messages.map((message) => (
                <UIText
                  key={message.id}
                  modifiers={[font({ size: 14 }), foregroundStyle(message.role === "user" ? textColors.label : textColors.secondaryLabel)]}
                >
                  {message.text}
                </UIText>
              ))}
            </VStack>
          </ScrollView>
        </VStack>
      </Host>
    </View>
  );
};

const styles = StyleSheet.create({
  page: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
});
