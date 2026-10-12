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
import { Button, ContextMenu, Host, HStack, Image, List, Menu, RNHostView, ScrollView, Section, Spacer, Text as UIText, Toggle, VStack, ZStack } from "@expo/ui/swift-ui";
import { Animation, animation, background, contentShape, cornerRadius, defaultScrollAnchor, font, foregroundStyle, frame, glassEffect, lineLimit, listRowBackground, listRowInsets, listRowSeparator, listRowSpacing, listStyle, menuActionDismissBehavior, offset, onTapGesture, padding, scaleEffect, scrollContentBackground, shapes, tag } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { useAppContext } from "../AppContext";
import { BarWindowResizeContext } from "../BarWindow";
import { colors } from "../colors";
import { COMPOSER_PILL_HEIGHT } from "../composerBarSpec";
import { lastSummary } from "../chat/model";
import { useKeptConversation } from "../conversations/useConversations";
import { usePreloadConversation } from "../conversations/usePreloadConversation";
import type { FileRef } from "../dubzSuggestions";
import { repoScope, sessionTarget } from "../favorites/model";
import { FavoriteScopeProvider, toggleFavorite, useFavoriteScope, useIsFavorited } from "../favorites/useFavorites";
import { sessionCardHeight, summaryLines, titleLines } from "../home/homeLayout";
import { Markdown } from "../Markdown";
import { serverAddressOf } from "../opencode/serverAddress";
import { abortSession, confirmDeleteSession, promptRenameSession } from "../sessionActions";
import { archiveWithUndo, toggleMute, useMutedSessions } from "../sessionArchive";
import { cachedSessionsNow } from "../sessionCache";
import { CardBody, sessionCardActions, summaryLabel } from "../SessionCard";
import { getSetupDate, loadReads } from "../sessionReads";
import type { SessionSummary } from "../sessions/sessionList";
import { useSessionPreview } from "../sessionPreview";
import { getApiAddress } from "../settings";
import { useTextColors, useTheme } from "../theme";
import { relativeTime } from "../time";
import { PILL_FONT_SIZE, PILL_PAD_H, titlePillWidth } from "../titlePillStyle";
import type { TranscriptMessage } from "../useSessionStream";
import { useSessionActivity } from "../useSessionActivity";
import { EdgeBlurBars } from "../EdgeBlurBars";
import { groupSessions } from "./groupSessions";
import { sessionsForFile } from "./sessionsForFile";

/** The session a row/list opens. */
export interface DubzOpenSession {
  readonly id: string;
  readonly title: string;
  readonly updated: number;
  /** Where the session runs — needed to send into it from the Dubz input. */
  readonly directory: string;
}

const PILL = 44;
const GAP = 8;
const NUMBER_WIDTH = 60;
/** The window's side margin (BarWindow) + the suggestions' padding, per side. */
const WINDOW_SIDE = 12 + 16;
/** How many extra sessions the expand reveals. */
const EXTRA = 4;
/** SwiftUI's own animation (UI thread), no Reanimated. */
const SLIDE = Animation.easeInOut({ duration: 0.28 });
export const SLIDE_MS = 280;
/** Stands in for SwiftUI `.infinity` so a frame fills. */
const FILL = 100000;
/** The header pill's top, matching the window's persistent back button. */
const TOP_INSET = 12;
/** The title pill's smallest width (matches HeaderTitlePill's MIN_WIDTH). */
const TITLE_PILL_MIN = 56;
/** The floating composer pill's space at the window's bottom: the pill, its
 * inset (BarWindow COMPOSER_INSET), and a gap. */
export const PILL_AREA = COMPOSER_PILL_HEIGHT + 12 + GAP;
/** Scroll content clears the overlaid header at the top, and the floating
 * composer pill at the bottom, so it passes BEHIND both bars as it scrolls. */
const HEADER_CLEARANCE = TOP_INSET + PILL + GAP;
const BOTTOM_CLEARANCE = PILL_AREA;

const toOpen = (s: SessionSummary): DubzOpenSession => ({ id: s.id, title: s.title, updated: s.time.updated, directory: s.directory });

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
  /** True while a sub-page is open: the area slides out to the left. */
  readonly shifted?: boolean;
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
      {/* Wrapper slides the whole area out left (natively) when a sub-page opens,
       * so main doesn't just pop out. The List's own animation (rows) is
       * separate. */}
      <VStack modifiers={[offset({ x: props.shifted === true ? -width : 0 }), animation(SLIDE, props.shifted === true), frame({ maxWidth: FILL, maxHeight: FILL, alignment: "bottomLeading" })]}>
        <List
          modifiers={[
            listStyle("plain"),
            scrollContentBackground("hidden"),
            listRowSpacing(GAP),
            animation(SLIDE, rows.length),
            // Inverted-list trick: flip the List vertically so its content sticks
            // to the bottom; each row is flipped back so it reads upright.
            scaleEffect({ x: 1, y: -1 }),
            frame({ maxWidth: FILL, maxHeight: FILL }),
          ]}
        >
          <List.ForEach>
            {/* Reversed because the List is flipped (scaleEffect y:-1): reversing
             * here makes the rows read in their natural top→bottom order, while the
             * flip keeps the whole block anchored to the bottom. */}
            {[...rows].reverse().map((row) => (
              <HStack key={row.id} modifiers={[tag(row.id), ...rowMods, scaleEffect({ x: 1, y: -1 }), frame({ width: rowWidth, alignment: "leading" })]}>
                {row.content}
              </HStack>
            ))}
          </List.ForEach>
        </List>
      </VStack>
    </Host>
  );
};

/** A round glass icon button (PILL), the page bar's trailing control. */
const GlassIconButton = (props: { readonly systemName: React.ComponentProps<typeof Image>["systemName"]; readonly onPress: () => void }): React.ReactElement => {
  const textColors = useTextColors();
  return (
    <HStack
      modifiers={[
        frame({ width: PILL, height: PILL, alignment: "center" }),
        glassEffect({ glass: { variant: "regular", interactive: true }, shape: "capsule" }),
        contentShape(shapes.capsule()),
        onTapGesture(props.onPress),
      ]}
    >
      <Image systemName={props.systemName} size={15} color={textColors.label} />
    </HStack>
  );
};

/** A section header in the grouped list (Unread / Today / N days ago …). */
const SectionHeader = (props: { readonly title: string }): React.ReactElement => {
  const textColors = useTextColors();
  return (
    <UIText modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle(textColors.secondaryLabel), padding({ top: 6, leading: 6 })]}>{props.title}</UIText>
  );
};

/** How the View All list is ordered. It's one worktree, so there's little to
 * sort by — recency (grouped by read status + age, the default) or the title. */
type SortKey = "recent" | "name";

/** The View All sort/filter menu (its trailing control): order by recency or
 * name, and an unread-only filter. A glass pill trigger over a native menu. */
const SortMenu = (props: {
  readonly sort: SortKey;
  readonly onSort: (sort: SortKey) => void;
  readonly unreadOnly: boolean;
  readonly onUnreadOnly: (on: boolean) => void;
}): React.ReactElement => {
  const textColors = useTextColors();
  return (
    <Menu
      label={
        <HStack
          modifiers={[
            frame({ width: PILL, height: PILL, alignment: "center" }),
            glassEffect({ glass: { variant: "regular", interactive: true }, shape: "capsule" }),
            contentShape(shapes.capsule()),
          ]}
        >
          <Image systemName="line.3.horizontal.decrease" size={15} color={textColors.label} />
        </HStack>
      }
    >
      <Section title="Sort by">
        <Toggle label="Recent" systemImage="clock" isOn={props.sort === "recent"} onIsOnChange={(on) => { if (on) props.onSort("recent"); }} modifiers={[menuActionDismissBehavior("disabled")]} />
        <Toggle label="Name" systemImage="textformat" isOn={props.sort === "name"} onIsOnChange={(on) => { if (on) props.onSort("name"); }} modifiers={[menuActionDismissBehavior("disabled")]} />
      </Section>
      <Section title="Show">
        <Toggle label="Unread only" systemImage="circlebadge.fill" isOn={props.unreadOnly} onIsOnChange={props.onUnreadOnly} modifiers={[menuActionDismissBehavior("disabled")]} />
      </Section>
    </Menu>
  );
};

/** The shared Dubz page top bar: a centred glass title pill (like the app's
 * HeaderTitlePill), with an optional trailing control (full-screen, a menu).
 * The back button is the window's persistent one (top-left), so the pill reads
 * centred between them. Used by every Dubz page so they're consistent. */
const PageHeader = (props: { readonly title: string; readonly width: number; readonly trailing?: React.ReactNode }): React.ReactElement => {
  const textColors = useTextColors();
  // Fixed width from the (always-known) title — the app's HeaderTitlePill
  // approach — capped so it clears the back (left) and trailing (right) buttons.
  // A hug/maxWidth frame went greedy (always full) in the ZStack, so compute it.
  const pillWidth = Math.min(Math.max(titlePillWidth(props.title, false), TITLE_PILL_MIN), props.width - 2 * (PILL + GAP));
  return (
    <ZStack modifiers={[frame({ width: props.width, height: PILL })]}>
      {/* Centred title pill at its computed width; the title truncates within. */}
      <HStack
        modifiers={[
          frame({ width: pillWidth, height: PILL, alignment: "center" }),
          padding({ horizontal: PILL_PAD_H }),
          glassEffect({ glass: { variant: "regular" }, shape: "capsule" }),
        ]}
      >
        <UIText modifiers={[font({ size: PILL_FONT_SIZE, weight: "semibold" }), foregroundStyle(textColors.label), lineLimit(1)]}>{props.title}</UIText>
      </HStack>
      {/* The resize grabber, just inside the pill's top (top-centre), overlaid so
       * it doesn't widen the pill — the pill itself is the grab area (see
       * DubzScrollPage). */}
      <HStack modifiers={[frame({ maxWidth: FILL, maxHeight: FILL, alignment: "top" }), padding({ top: 6 })]}>
        <HStack modifiers={[frame({ width: 32, height: 5 }), background("rgba(120,120,128,0.55)"), cornerRadius(3)]}>
          <Spacer />
        </HStack>
      </HStack>
      {/* Trailing control, overlaid at the right. */}
      {props.trailing !== undefined ? <HStack modifiers={[frame({ width: props.width, height: PILL, alignment: "trailing" })]}>{props.trailing}</HStack> : null}
    </ZStack>
  );
};

/** A Dubz sub-page: a full-height native scroll with the header pill floating
 * over its top. The scroll fills the window body, so its content passes BEHIND
 * the header (top) and the composer pill (bottom) as it scrolls; the content is
 * inset to clear both bars at rest. Slides in from the right natively. */
const DubzScrollPage = (props: {
  readonly pageWidth: number;
  readonly shifted: boolean;
  readonly title: string;
  readonly spacing: number;
  readonly trailing?: React.ReactNode;
  /** Chat pages anchor to the bottom (newest in view); lists stay at the top. */
  readonly bottomAnchored?: boolean;
  readonly children: React.ReactNode;
}): React.ReactElement => {
  const { width } = useWindowDimensions();
  // The window's resize gesture, so the title pill is the grab area (the top
  // grabber is hidden on sub-pages — see BarWindow grabberHidden).
  const resize = React.useContext(BarWindowResizeContext);
  return (
    <View style={styles.page} pointerEvents={props.shifted ? "auto" : "none"}>
      {/* Scroll content — its own Host, slides. Fills the body so content passes
       * behind the top feather + header pill and the bottom composer pill. */}
      <Host style={{ flex: 1 }} ignoreSafeArea="all">
        <ScrollView showsIndicators={false} modifiers={[frame({ maxWidth: FILL, maxHeight: FILL, alignment: "topLeading" }), ...(props.bottomAnchored === true ? [defaultScrollAnchor("bottom")] : []), offset({ x: props.shifted ? 0 : width }), animation(SLIDE, props.shifted)]}>
          <VStack alignment="leading" spacing={props.spacing} modifiers={[frame({ width: props.pageWidth, alignment: "leading" }), padding({ top: HEADER_CLEARANCE, bottom: BOTTOM_CLEARANCE })]}>
            {props.children}
          </VStack>
        </ScrollView>
      </Host>
      {/* Feathered blur over the scroll's top, under the header pill — the RN
       * VariableBlur (same as the bottom feather), layered between the scroll
       * Host above and the header Host below. Subtle. */}
      <EdgeBlurBars variant="top" blurRadius={1} />
      {/* The header pill — its own Host over the feather, sliding with the page
       * (sized to the header area so it never covers the scroll below). */}
      <View style={styles.headerSlot} pointerEvents="box-none">
        <Host style={{ flex: 1 }} ignoreSafeArea="all">
          <VStack modifiers={[frame({ maxWidth: FILL, maxHeight: FILL, alignment: "top" }), offset({ x: props.shifted ? 0 : width }), animation(SLIDE, props.shifted), padding({ top: TOP_INSET })]}>
            <PageHeader title={props.title} width={props.pageWidth} trailing={props.trailing} />
          </VStack>
        </Host>
      </View>
      {/* The title pill IS the resize grab area: a transparent pan zone over the
       * pill (centred, its max width — clear of the leading/trailing buttons)
       * driving the window's own resize gesture. */}
      {resize !== undefined ? (
        <View style={styles.grabZone} pointerEvents="box-none">
          <GestureDetector gesture={resize}>
            <View style={{ width: props.pageWidth - 2 * (PILL + GAP), height: PILL }} />
          </GestureDetector>
        </View>
      ) : null}
    </View>
  );
};

/** A session open in the window: the header pill, then the transcript. */
export const DubzSessionPage = (props: {
  readonly session: DubzOpenSession;
  readonly onFullScreen: () => void;
  readonly shifted?: boolean;
}): React.ReactElement => {
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
    <DubzScrollPage pageWidth={pageWidth} shifted={shifted} title={props.session.title} spacing={10} bottomAnchored trailing={<GlassIconButton systemName="arrow.up.left.and.arrow.down.right" onPress={props.onFullScreen} />}>
      {messages.map((message) => (
        <ChatBubble key={message.id} role={message.role} text={message.text} width={pageWidth} />
      ))}
    </DubzScrollPage>
  );
};

/** Bubble padding, shared by the layout and the markdown's inner width. */
const BUBBLE_PAD_H = 14;

/** One chat message as a glass bubble. Outbound (user) is a native, white,
 * inline-markdown bubble, trailing and constrained. Inbound (agent) is a
 * FULL-WIDTH glass bubble rendering the REAL markdown (code fences, lists, …)
 * via the app's Markdown in an RNHostView, so it uses all the space. */
const ChatBubble = (props: { readonly role: "user" | "assistant"; readonly text: string; readonly width: number }): React.ReactElement => {
  if (props.role === "user") {
    const maxBubble = Math.round(props.width * 0.84);
    return (
      <HStack modifiers={[frame({ width: props.width, alignment: "trailing" })]}>
        <HStack
          modifiers={[
            padding({ horizontal: BUBBLE_PAD_H, vertical: 10 }),
            frame({ maxWidth: maxBubble, alignment: "leading" }),
            glassEffect({ glass: { variant: "regular", tint: colors.tint }, shape: "roundedRectangle", cornerRadius: 18 }),
          ]}
        >
          <UIText markdownEnabled modifiers={[font({ size: 15 }), foregroundStyle("#FFFFFF")]}>{props.text}</UIText>
        </HStack>
      </HStack>
    );
  }
  return (
    <VStack
      alignment="leading"
      modifiers={[
        padding({ horizontal: BUBBLE_PAD_H, vertical: 10 }),
        frame({ width: props.width, alignment: "leading" }),
        glassEffect({ glass: { variant: "regular" }, shape: "roundedRectangle", cornerRadius: 18 }),
      ]}
    >
      <RNHostView matchContents>
        <Markdown text={props.text} width={props.width - BUBBLE_PAD_H * 2} />
      </RNHostView>
    </VStack>
  );
};

/** One session as the native glass card — the SAME visual (CardBody) and the
 * SAME context menu (sessionCardActions) as Home's SessionCard, so a change to
 * either shows on both. No swipe and no Host of its own: it is a SwiftUI child
 * of the list's ScrollView, so the page stays one Host and slides natively. */
const DubzSessionCard = (props: {
  readonly session: SessionSummary;
  readonly width: number;
  readonly running: boolean;
  readonly unread: boolean;
  readonly muted: boolean;
  readonly onOpen: () => void;
  readonly onRename: () => void;
  readonly onStop: () => void;
  readonly onDelete: () => void;
  readonly onArchive: () => void;
  readonly onMute: () => void;
}): React.ReactElement => {
  const { session } = props;
  const { address } = useAppContext();
  const { colors: themeColors } = useTheme();
  // Open a chat: its newest messages are kept before the tap (preload).
  usePreloadConversation(session.id, session.time.updated, session.title);
  const kept = useKeptConversation(serverAddressOf(address), session.id);
  const summary = kept === undefined ? undefined : lastSummary(kept.messages);
  const summaryText = summary === undefined ? undefined : summaryLabel(summary.role, summary.text);
  const scope = useFavoriteScope();
  const favorite = useIsFavorited(scope, sessionTarget(session.id));
  // No worktree pill here (the Dubz list doesn't need it); the height fits the
  // title and the summary exactly, from cached text, so it's right on load.
  const height = sessionCardHeight({ titleLines: titleLines(session.title), pills: false, summaryLines: summaryLines(summaryText) });
  const actions = sessionCardActions({
    muted: props.muted,
    archived: false,
    running: props.running,
    favorite,
    onOpen: props.onOpen,
    onRename: props.onRename,
    onMute: props.onMute,
    onToggleFavorite: () => void toggleFavorite(scope, sessionTarget(session.id)),
    onArchive: props.onArchive,
    onStop: props.onStop,
    onDelete: props.onDelete,
  });
  return (
    <ContextMenu>
      <ContextMenu.Items>
        {actions.primary.map((action) => (
          <Button key={action.key} label={action.label} systemImage={action.systemImage} onPress={action.onPress} />
        ))}
        <Section>
          {actions.danger.map((action) => (
            <Button key={action.key} label={action.label} role="destructive" systemImage={action.systemImage} onPress={action.onPress} />
          ))}
        </Section>
      </ContextMenu.Items>
      <ContextMenu.Trigger>
        <VStack modifiers={[contentShape(shapes.rectangle()), onTapGesture(props.onOpen)]}>
          <CardBody
            width={props.width}
            height={height}
            titleLines={titleLines(session.title)}
            title={session.title}
            meta={relativeTime(session.time.updated)}
            unread={props.unread}
            unreadColor={themeColors.secondary}
            muted={props.muted}
            summary={summaryText}
          />
        </VStack>
      </ContextMenu.Trigger>
    </ContextMenu>
  );
};

/** View All: every worktree session by recency, as the native session card
 * (reused from Home). */
export const DubzSessionListPage = (props: {
  readonly file: FileRef;
  readonly onOpen: (session: DubzOpenSession) => void;
  readonly shifted?: boolean;
}): React.ReactElement => {
  const { width } = useWindowDimensions();
  const pageWidth = width - WINDOW_SIDE * 2;
  const shifted = props.shifted === true;
  const { client, address } = useAppContext();
  // Favoriting from this list pins to the file's repo scope (as the repo's own
  // session list does), not Home.
  const favScope = React.useMemo(() => repoScope(props.file.repo), [props.file.repo]);

  // A rename/delete/mute refreshes the list from the (globally-updated) cache.
  const [refresh, setRefresh] = React.useState(0);
  const bump = React.useCallback(() => setRefresh((n) => n + 1), []);
  const { all } = React.useMemo(() => sessionsForFile(cachedSessionsNow(), props.file.path), [props.file.path, refresh]);

  // Unread, running, muted — the same signals Home's cards use.
  const [reads, setReads] = React.useState<ReadonlyMap<string, number>>(new Map());
  const [setupDate, setSetupDate] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    void Promise.all([loadReads(), getSetupDate()]).then(([nextReads, date]) => {
      setReads(nextReads);
      setSetupDate(date);
    });
  }, [refresh]);
  const { busy, activityAt } = useSessionActivity(client, shifted);
  const mutedSet = useMutedSessions();
  const isUnread = (session: SessionSummary): boolean =>
    Math.max(session.time.updated, activityAt.get(session.id) ?? 0) > Math.max(reads.get(session.id) ?? 0, setupDate);

  // Sort/filter from the header menu. Recent groups by read status + age
  // (Unread, Today, Yesterday, N days/months/years ago); Name is a flat A–Z
  // list. Unread-only keeps the rest out.
  const [sort, setSort] = React.useState<SortKey>("recent");
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  const filtered = unreadOnly ? all.filter(isUnread) : all;

  const renderCard = (session: SessionSummary): React.ReactElement => (
    <DubzSessionCard
      key={session.id}
      session={session}
      width={pageWidth}
      running={busy.has(session.id)}
      unread={isUnread(session)}
      muted={mutedSet.has(session.id)}
      onOpen={() => props.onOpen(toOpen(session))}
      onRename={() => promptRenameSession(client, session.id, session.title, bump)}
      onStop={() => abortSession(client, session.id, bump)}
      onDelete={() => confirmDeleteSession(client, session.id, session.title, bump)}
      onArchive={() => archiveWithUndo(getApiAddress(address), session.id)}
      onMute={() => toggleMute(getApiAddress(address), session.id)}
    />
  );

  const rows =
    sort === "name"
      ? [...filtered].sort((a, b) => a.title.localeCompare(b.title)).map(renderCard)
      : groupSessions(filtered, isUnread, Date.now()).flatMap((group) => [
          <SectionHeader key={`section:${group.title}`} title={group.title} />,
          ...group.sessions.map(renderCard),
        ]);

  return (
    <FavoriteScopeProvider value={favScope}>
      <DubzScrollPage pageWidth={pageWidth} shifted={shifted} title="Sessions" spacing={GAP} trailing={<SortMenu sort={sort} onSort={setSort} unreadOnly={unreadOnly} onUnreadOnly={setUnreadOnly} />}>
        {rows}
      </DubzScrollPage>
    </FavoriteScopeProvider>
  );
};

const styles = StyleSheet.create({
  // No vertical padding: the scroll fills the body so content passes behind the
  // top and bottom bars; DubzScrollPage insets the content to clear them.
  page: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
  },
  // The header pill's own layer over the top feather — only the header area
  // tall, so it never covers (or blocks touches to) the scroll below it.
  headerSlot: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: TOP_INSET + PILL,
  },
  // The pan zone over the title pill (centred at the header's top).
  grabZone: {
    position: "absolute",
    top: TOP_INSET,
    left: 0,
    right: 0,
    alignItems: "center",
  },
});
