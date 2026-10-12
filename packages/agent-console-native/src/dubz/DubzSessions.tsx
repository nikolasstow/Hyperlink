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
import { Host, HStack, Image, Spacer, Text as UIText } from "@expo/ui/swift-ui";
import { contentShape, font, foregroundStyle, frame, glassEffect, lineLimit, onTapGesture, padding, shapes } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import type { FileRef } from "../dubzSuggestions";
import { cachedSessionsNow } from "../sessionCache";
import { type TextColors, useTextColors, useThemedStyles } from "../theme";
import { sessionsForFile } from "./sessionsForFile";

/** The session a row opens. */
export interface DubzOpenSession {
  readonly id: string;
  readonly title: string;
}

const ROW_HEIGHT = 44;
const NUMBER_WIDTH = 52;
const ROW_GAP = 8;
/** The window's side margin (BarWindow) plus the suggestions' padding, per side:
 * the row stretches to exactly this, so it never overflows the window. */
const WINDOW_SIDE = 12 + 16;

/**
 * The session suggestion: one native row — a big pill (most related session) and
 * a number pill (sessions in the file's worktree), filling the window width.
 */
export const DubzSessionRow = (props: {
  readonly file: FileRef;
  readonly onOpen: (session: DubzOpenSession) => void;
}): React.ReactElement | null => {
  const textColors = useTextColors();
  const { width } = useWindowDimensions();
  const { related, all } = React.useMemo(() => sessionsForFile(cachedSessionsNow(), props.file.path), [props.file.path]);
  const top = related[0] ?? all[0];
  if (top === undefined) return null;
  const rowWidth = width - WINDOW_SIDE * 2;
  const bigWidth = Math.max(100, rowWidth - NUMBER_WIDTH - ROW_GAP);
  const open = (): void => props.onOpen({ id: top.id, title: top.title });
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

/**
 * A placeholder session page inside the Dubz window — a native glass header (a
 * back button to the main view, the title, a full-screen button to the proper
 * page) over an empty body. It stands in for the real chat so the transition
 * and the glass buttons can be got right before the heavy chat goes in.
 */
export const DubzSessionPlaceholder = (props: {
  readonly title: string;
  readonly onBack: () => void;
  readonly onFullScreen: () => void;
}): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const { width } = useWindowDimensions();
  const headerWidth = width - WINDOW_SIDE * 2;
  return (
    <View style={styles.page}>
      <Host style={{ width: headerWidth, height: BUTTON }} ignoreSafeArea="all">
        <HStack spacing={10} alignment="center">
          <HStack
            modifiers={[
              frame({ width: BUTTON, height: BUTTON, alignment: "center" }),
              glassEffect({ glass: { variant: "regular", interactive: true }, shape: "capsule" }),
              contentShape(shapes.capsule()),
              onTapGesture(props.onBack),
            ]}
          >
            <Image systemName="chevron.left" size={15} color={textColors.label} />
          </HStack>
          <UIText modifiers={[font({ size: 16, weight: "semibold" }), foregroundStyle(textColors.label), lineLimit(1)]}>{props.title}</UIText>
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
      </Host>
      <View style={styles.placeholderBody}>
        <Text style={styles.placeholderText}>Session chat goes here</Text>
      </View>
    </View>
  );
};

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
    page: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: 16,
      paddingBottom: 16,
    },
    placeholderBody: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    placeholderText: {
      color: text.secondaryLabel,
      fontSize: 14,
    },
  });
