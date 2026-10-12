/**
 * Sessions inside the Dubz window, all SwiftUI (so nothing React renders in the
 * window's glass) fed by React data.
 *
 * - DubzSessionArea: the session row. Collapsed, a big pill (most related
 *   session) + a number pill (chat icon + count in the file's worktree). Tap the
 *   number to expand: four more sessions animate in, the number becomes a
 *   chevron to collapse, and a ( + )( View All ) row appears. View All opens the
 *   full list page.
 * - DubzSessionPage: a session open in the window — a session-style glass title
 *   pill header + a full-screen button, over the transcript (native Text rows in
 *   a native ScrollView, from the kept/preview conversation).
 * - DubzSessionListPage: every worktree session by recency, as glass rows.
 * - DubzTopBack: the window's persistent top-left glass back button.
 *
 * Transitions and the expand are SwiftUI's own (animation + offset), UI thread,
 * no Reanimated.
 *
 * @internal
 */
import { Host, HStack, Image, List, ScrollView, Spacer, Text as UIText, VStack } from "@expo/ui/swift-ui";
import { Animation, animation, contentShape, defaultScrollAnchor, font, foregroundStyle, frame, glassEffect, lineLimit, listRowBackground, listRowInsets, listRowSeparator, listRowSpacing, listStyle, offset, onTapGesture, padding, scrollContentBackground, shapes, tag } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { useAppContext } from "../AppContext";
import type { FileRef } from "../dubzSuggestions";
import { cachedSessionsNow } from "../sessionCache";
import type { SessionSummary } from "../sessions/sessionList";
import { useSessionPreview } from "../sessionPreview";
import { useTextColors } from "../theme";
import type { TranscriptMessage } from "../useSessionStream";
import { sessionsForFile } from "./sessionsForFile";

/** The session a row/list opens. */
export interface DubzOpenSession {
  readonly id: string;
  readonly title: string;
  readonly updated: number;
}

const PILL = 44;
const GAP = 8;
const NUMBER_WIDTH = 60;
/** The window's side margin (BarWindow) + the suggestions' padding, per side. */
const WINDOW_SIDE = 12 + 16;
/** Space the page title clears for the window's persistent back button. */
const BACK_INSET = PILL + 10;
/** How many extra sessions the expand reveals. */
const EXTRA = 4;
/** SwiftUI's own animation (UI thread), no Reanimated. */
const SLIDE = Animation.easeInOut({ duration: 0.28 });
export const SLIDE_MS = 280;
/** Stands in for SwiftUI `.infinity` so a frame fills. */
const FILL = 100000;

const toOpen = (s: SessionSummary): DubzOpenSession => ({ id: s.id, title: s.title, updated: s.time.updated });

const messageText = (message: TranscriptMessage): string =>
  [...message.parts.values()]
    .filter((part) => part.type === "text" && part.synthetic !== true)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();

/** The window's persistent top-left glass back button. */
export const DubzTopBack = (props: { readonly onPress: () => void }): React.ReactElement => {
  const textColors = useTextColors();
  return (
    <Host style={{ width: PILL, height: PILL }} ignoreSafeArea="all">
      <HStack
        modifiers={[
          frame({ width: PILL, height: PILL, alignment: "center" }),
          glassEffect({ glass: { variant: "regular", interactive: true }, shape: "capsule" }),
          contentShape(shapes.capsule()),
          onTapGesture(props.onPress),
        ]}
      >
        <Image systemName="chevron.left" size={17} color={textColors.label} />
      </HStack>
    </Host>
  );
};

/** The session row, collapsed or expanded. Lives in a bottom-anchored native
 * scroll, so the content always sits just above the pill and expanding grows it
 * upward (and scrolls if it runs past the window). */
export const DubzSessionArea = (props: {
  readonly file: FileRef;
  readonly onOpen: (session: DubzOpenSession) => void;
  readonly onViewAll: () => void;
}): React.ReactElement | null => {
  const textColors = useTextColors();
  const { width } = useWindowDimensions();
  const { related, all } = React.useMemo(() => sessionsForFile(cachedSessionsNow(), props.file.path), [props.file.path]);
  const sessions = related.length > 0 ? related : all;
  const [expanded, setExpanded] = React.useState(false);
  const top = sessions[0];
  if (top === undefined) return null;
  const rowWidth = width - WINDOW_SIDE * 2;
  const bigWidth = Math.max(100, rowWidth - NUMBER_WIDTH - GAP);
  const extras = sessions.slice(1, 1 + EXTRA);

  const sessionPill = (session: SessionSummary, pillWidth: number): React.ReactElement => (
    <HStack
      key={session.id}
      spacing={8}
      modifiers={[
        padding({ horizontal: 16 }),
        frame({ width: pillWidth, height: PILL, alignment: "leading" }),
        glassEffect({ glass: { variant: "regular" }, shape: "capsule" }),
        contentShape(shapes.capsule()),
        onTapGesture(() => props.onOpen(toOpen(session))),
      ]}
    >
      <UIText modifiers={[font({ size: 16, weight: "semibold" }), foregroundStyle(textColors.label), lineLimit(1)]}>{session.title}</UIText>
    </HStack>
  );

  const viewAllWidth = Math.max(80, rowWidth - PILL - GAP);
  // Row chrome so the glass pills float in the List — clear background, no
  // separators, no insets.
  const rowMods = [listRowBackground("#00000000"), listRowSeparator("hidden"), listRowInsets({ top: 0, bottom: 0, leading: 0, trailing: 0 })];

  const toggle = (
    <HStack
      spacing={5}
      modifiers={[
        frame({ width: NUMBER_WIDTH, height: PILL, alignment: "center" }),
        glassEffect({ glass: { variant: "regular", interactive: true }, shape: "capsule" }),
        contentShape(shapes.capsule()),
        onTapGesture(() => setExpanded((e) => !e)),
      ]}
    >
      {expanded ? (
        <Image systemName="chevron.down" size={15} color={textColors.secondaryLabel} />
      ) : (
        <>
          <Image systemName="bubble.left.and.bubble.right.fill" size={13} color={textColors.secondaryLabel} />
          <UIText modifiers={[font({ size: 15, weight: "semibold" }), foregroundStyle(textColors.secondaryLabel)]}>{String(sessions.length)}</UIText>
        </>
      )}
    </HStack>
  );

  // One row each, as proper List items (tagged for identity) so SwiftUI animates
  // them in/out one at a time. Order top→bottom; bottom-anchored, so expanding
  // adds the extras + actions below and pushes the main row up.
  const rows: ReadonlyArray<{ readonly id: string; readonly content: React.ReactNode }> = [
    { id: "main", content: (<HStack spacing={GAP} modifiers={[frame({ width: rowWidth, alignment: "leading" })]}>{sessionPill(top, bigWidth)}{toggle}</HStack>) },
    ...(expanded ? extras.map((session) => ({ id: session.id, content: sessionPill(session, rowWidth) })) : []),
    ...(expanded
      ? [
          {
            id: "actions",
            content: (
              <HStack spacing={GAP} modifiers={[frame({ width: rowWidth, alignment: "leading" })]}>
                <HStack modifiers={[frame({ width: PILL, height: PILL, alignment: "center" }), glassEffect({ glass: { variant: "regular", interactive: true }, shape: "capsule" }), contentShape(shapes.capsule())]}>
                  <Image systemName="plus" size={16} color={textColors.label} />
                </HStack>
                <HStack
                  spacing={6}
                  modifiers={[
                    padding({ horizontal: 16 }),
                    frame({ width: viewAllWidth, height: PILL, alignment: "center" }),
                    glassEffect({ glass: { variant: "regular", interactive: true }, shape: "capsule" }),
                    contentShape(shapes.capsule()),
                    onTapGesture(props.onViewAll),
                  ]}
                >
                  <UIText modifiers={[font({ size: 15, weight: "semibold" }), foregroundStyle(textColors.label), lineLimit(1)]}>View All</UIText>
                  <Image systemName="chevron.right" size={13} color={textColors.secondaryLabel} />
                </HStack>
              </HStack>
            ),
          },
        ]
      : []),
  ];

  return (
    // List.ForEach gives per-item insert/remove animation. It fills the body and
    // sits at the top — bottom-anchoring an animated List is the open problem
    // (see the handoff); a ScrollView-wrapped fixedSize List renders nothing.
    <Host style={{ flex: 1 }} ignoreSafeArea="all">
      <List
        modifiers={[
          listStyle("plain"),
          scrollContentBackground("hidden"),
          listRowSpacing(GAP),
          animation(SLIDE, rows.length),
          frame({ maxWidth: FILL, maxHeight: FILL }),
        ]}
      >
        <List.ForEach>
          {rows.map((row) => (
            <HStack key={row.id} modifiers={[tag(row.id), ...rowMods, frame({ width: rowWidth, alignment: "leading" })]}>
              {row.content}
            </HStack>
          ))}
        </List.ForEach>
      </List>
    </Host>
  );
};

/** A session-style glass title pill + a full-screen button, matching the chat's
 * top bar. The back button is the window's persistent one. */
const PageHeader = (props: { readonly title: string; readonly width: number; readonly onFullScreen: () => void }): React.ReactElement => {
  const textColors = useTextColors();
  return (
    <HStack spacing={10} alignment="center" modifiers={[padding({ leading: BACK_INSET }), frame({ width: props.width, height: PILL, alignment: "leading" })]}>
      <HStack
        modifiers={[
          padding({ horizontal: 14 }),
          frame({ height: PILL, alignment: "center" }),
          glassEffect({ glass: { variant: "regular" }, shape: "capsule" }),
        ]}
      >
        <UIText modifiers={[font({ size: 15, weight: "semibold" }), foregroundStyle(textColors.label), lineLimit(1)]}>{props.title}</UIText>
      </HStack>
      <Spacer />
      <HStack
        modifiers={[
          frame({ width: PILL, height: PILL, alignment: "center" }),
          glassEffect({ glass: { variant: "regular", interactive: true }, shape: "capsule" }),
          contentShape(shapes.capsule()),
          onTapGesture(props.onFullScreen),
        ]}
      >
        <Image systemName="arrow.up.left.and.arrow.down.right" size={15} color={textColors.label} />
      </HStack>
    </HStack>
  );
};

/** A session open in the window: the header pill, then the transcript. */
export const DubzSessionPage = (props: {
  readonly session: DubzOpenSession;
  readonly onFullScreen: () => void;
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
          <PageHeader title={props.session.title} width={pageWidth} onFullScreen={props.onFullScreen} />
          <ScrollView showsIndicators={false} modifiers={[frame({ maxWidth: FILL, maxHeight: FILL, alignment: "topLeading" })]}>
            <VStack alignment="leading" spacing={12} modifiers={[frame({ width: pageWidth, alignment: "leading" })]}>
              {messages.map((message) => (
                <UIText key={message.id} modifiers={[font({ size: 14 }), foregroundStyle(message.role === "user" ? textColors.label : textColors.secondaryLabel)]}>
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

/** View All: every worktree session by recency, as glass rows. */
export const DubzSessionListPage = (props: {
  readonly file: FileRef;
  readonly onOpen: (session: DubzOpenSession) => void;
  readonly shifted?: boolean;
}): React.ReactElement => {
  const textColors = useTextColors();
  const { width } = useWindowDimensions();
  const pageWidth = width - WINDOW_SIDE * 2;
  const shifted = props.shifted === true;
  const { all } = React.useMemo(() => sessionsForFile(cachedSessionsNow(), props.file.path), [props.file.path]);
  return (
    <View style={styles.page} pointerEvents={shifted ? "auto" : "none"}>
      <Host style={{ flex: 1 }} ignoreSafeArea="all">
        <VStack alignment="leading" spacing={10} modifiers={[frame({ maxWidth: FILL, maxHeight: FILL, alignment: "topLeading" }), offset({ x: shifted ? 0 : width }), animation(SLIDE, shifted)]}>
          <HStack modifiers={[padding({ leading: BACK_INSET }), frame({ width: pageWidth, height: PILL, alignment: "leading" })]}>
            <HStack modifiers={[padding({ horizontal: 14 }), frame({ height: PILL, alignment: "center" }), glassEffect({ glass: { variant: "regular" }, shape: "capsule" })]}>
              <UIText modifiers={[font({ size: 15, weight: "semibold" }), foregroundStyle(textColors.label)]}>Sessions</UIText>
            </HStack>
            <Spacer />
          </HStack>
          <ScrollView showsIndicators={false} modifiers={[frame({ maxWidth: FILL, maxHeight: FILL, alignment: "topLeading" })]}>
            <VStack alignment="leading" spacing={GAP} modifiers={[frame({ width: pageWidth, alignment: "leading" })]}>
              {all.map((session) => (
                <HStack
                  key={session.id}
                  modifiers={[
                    padding({ horizontal: 16 }),
                    frame({ width: pageWidth, height: PILL, alignment: "leading" }),
                    glassEffect({ glass: { variant: "regular" }, shape: "capsule" }),
                    contentShape(shapes.capsule()),
                    onTapGesture(() => props.onOpen(toOpen(session))),
                  ]}
                >
                  <UIText modifiers={[font({ size: 16, weight: "semibold" }), foregroundStyle(textColors.label), lineLimit(1)]}>{session.title}</UIText>
                </HStack>
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
