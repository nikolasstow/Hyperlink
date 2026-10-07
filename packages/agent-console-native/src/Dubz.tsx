/**
 * Dubz — the app-wide assistant, as a page of the bottom bar.
 *
 * Its window is a BarWindow (collapsed the bar, expanded the window grown up
 * out of it, clear glass): Dubz adds the pill's row (+, what is typed, send),
 * its suggestions above the pill, and the swipe back to the composer.
 *
 * Where the bar is a composer (Home, a repo, a session), Composer puts this
 * page beside its own and slides between them (`pageBack` here). Where there is
 * nothing to compose (Files), `DubzBar` is the bar, with this its only page.
 *
 * @internal
 */
import * as React from "react";
import { Pressable, StyleSheet, TextInput, useWindowDimensions, View } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import Reanimated, { Easing, runOnJS, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AGENT_NAME, useAgentButtonVisible, type AgentSurface } from "./agentButtonSettings";
import { BarWindow, detentMemory } from "./BarWindow";
import { COMPOSER_CHIP_SIZE, COMPOSER_SEND_CHIP_SIZE } from "./composerBarSpec";
import { PlusChip, SendChip } from "./composerChips";
import { suggestionsFor, type DubzContext, type DubzSuggestion } from "./dubzSuggestions";
import { getBarPages, getDubzDetent, setBarPages, setDubzDetent, type BarPage } from "./settings";
import { composerRestingBottom, useKeyboardSlide } from "./useKeyboardSlide";
import { type TextColors, useTextColors, useThemedStyles } from "./theme";

/** The line of text a collapsed pill shows, and a single line's height. */
const LINE_HEIGHT = 21;
const INPUT_MAX_LINES = 8;

/** How long a page slides on after a swipe is let go. */
export const PAGE_MS = 260;
/** How far (a fraction of the screen) a swipe must carry a page to turn it,
 * unless it is flung. */
export const PAGE_TURN = 0.35;
/** Fling speed (px/s) that turns the page however far it went. */
export const PAGE_FLING = 700;
/** How far a finger moves sideways before a swipe starts paging, and up or
 * down before it gives way to the vertical gestures. */
export const PAGE_SLOP_X = 16;
export const PAGE_SLOP_Y = 12;
export const pageEasing = Easing.out(Easing.cubic);

// ── The page the bar opens to, per page type ────────────────────────────────

/** Each page type's page before one is chosen there: Dubz, unless the type
 * has its own (a session: its message composer, the conversation being the
 * point). Choosing a page on a page type makes it that type's default. */
const DEFAULT_PAGE: Readonly<Record<AgentSurface, BarPage>> = {
  home: "dubz",
  repo: "dubz",
  session: "compose",
  editor: "dubz",
};

let chosenPages: Readonly<Record<string, BarPage>> = {};
const pageListeners = new Set<() => void>();
const subscribePage = (listener: () => void): (() => void) => {
  pageListeners.add(listener);
  return () => pageListeners.delete(listener);
};
getBarPages().then(
  (pages) => {
    // Anything chosen meanwhile is newer; keep it.
    chosenPages = {
      ...pages,
      ...chosenPages,
    };
    pageListeners.forEach((listener) => listener());
  },
  (error: unknown) => console.error("[dubz] reading the bar's pages failed", error),
);

/** Remember the page chosen on a page type: it is that type's page from now
 * on, on every page of the type. */
export const rememberPage = (pageType: AgentSurface, page: BarPage): void => {
  if (chosenPages[pageType] === page) return;
  chosenPages = {
    ...chosenPages,
    [pageType]: page,
  };
  pageListeners.forEach((listener) => listener());
  setBarPages(chosenPages).catch((error: unknown) => console.error("[dubz] saving the bar's pages failed", error));
};

/** The page a page type's bar opens to (and shows collapsed). */
export const useBarPage = (pageType: AgentSurface): BarPage =>
  React.useSyncExternalStore(subscribePage, () => chosenPages[pageType] ?? DEFAULT_PAGE[pageType]);

// ── What is typed to Dubz, the same on every screen ─────────────────────────

let draft = "";
const draftListeners = new Set<() => void>();
const subscribeDraft = (listener: () => void): (() => void) => {
  draftListeners.add(listener);
  return () => draftListeners.delete(listener);
};
const setDraft = (text: string): void => {
  draft = text;
  draftListeners.forEach((listener) => listener());
};

// ── The detent last left ────────────────────────────────────────────────────

// Shared by every screen's page; persisted across launches.
const dubzDetent = detentMemory(0, (frac, kbFull) =>
  setDubzDetent({ frac, kbFull }).catch((error: unknown) => console.error("[dubz] saving the detent failed", error)),
);
getDubzDetent().then(
  (value) => {
    if (value !== undefined) dubzDetent.restore(value.frac, value.kbFull);
  },
  (error: unknown) => console.error("[dubz] reading the detent failed", error),
);

const noop = (): void => undefined;

/** Sliding back to the composer, where it is beside this page. */
export interface PageBack {
  /** Where the pages stand: 1 this page, 0 the composer. */
  readonly pageX: SharedValue<number>;
  /** A swipe back begins. `open`: Dubz is open (so the composer readies
   * itself, expanded, off to the left); collapsed, the bars just slide. */
  readonly begin: (open: boolean) => void;
  /** The swipe turned the page, and the slide has finished. */
  readonly turn: (open: boolean) => void;
  /** The swipe fell back, and the slide has finished. */
  readonly stay: (open: boolean) => void;
}

export interface DubzPageProps {
  readonly open: boolean;
  /** Open or collapse without the grow (a page slid in, or away). */
  readonly instant: boolean;
  /** A tap on the collapsed bar. */
  readonly onOpen: () => void;
  /** Tap outside, a fling down, or the keyboard going down at the smallest
   * detent. */
  readonly onClose: () => void;
  readonly inputRef: React.RefObject<TextInput | null>;
  /** Where it was opened: decides its suggestions (dubzSuggestions.ts). */
  readonly context: DubzContext;
  /** Where the composer is beside it; omitted where Dubz is the only page. */
  readonly pageBack?: PageBack;
  /** Parked off-screen (by layout) when collapsed, so something else holds its
   * spot — Files' chat button, which the min view grows from. */
  readonly hiddenCollapsed?: boolean;
}

/** Clamp to [0, 1]. */
const unit = (value: number): number => {
  "worklet";
  return value < 0 ? 0 : value > 1 ? 1 : value;
};

export const DubzPage = (props: DubzPageProps): React.ReactElement => {
  const styles = useThemedStyles(makeStyles);
  const textColors = useTextColors();
  const { open, instant, onOpen, onClose, inputRef, context, pageBack, hiddenCollapsed } = props;
  const suggestions = React.useMemo(() => suggestionsFor(context), [context]);
  const { width: screenW } = useWindowDimensions();
  const text = React.useSyncExternalStore(subscribeDraft, () => draft);

  // Swipe right, where the composer is beside it, to slide back to it. Only a
  // clear sideways drag pages. The page's own work (focus, state) waits until
  // the slide has finished, so nothing on the JS side competes with its frames.
  const fallbackPageX = useSharedValue(1);
  const pageX = pageBack?.pageX ?? fallbackPageX;
  const begin = pageBack?.begin ?? noop;
  const turn = pageBack?.turn ?? noop;
  const stay = pageBack?.stay ?? noop;
  // Open or collapsed: collapsed, it slides between the two bars.
  const paging = React.useMemo(
    () =>
      Gesture.Pan()
        .enabled(pageBack !== undefined)
        .activeOffsetX([-PAGE_SLOP_X, PAGE_SLOP_X])
        .failOffsetY([-PAGE_SLOP_Y, PAGE_SLOP_Y])
        .onStart(() => {
          runOnJS(begin)(open);
        })
        .onUpdate((e) => {
          pageX.value = 1 - unit(e.translationX / screenW);
        })
        .onEnd((e) => {
          const turned = 1 - pageX.value > PAGE_TURN || e.velocityX > PAGE_FLING;
          pageX.value = withTiming(turned ? 0 : 1, { duration: PAGE_MS, easing: pageEasing }, (finished) => {
            if (finished === true) runOnJS(turned ? turn : stay)(open);
          });
        }),
    [open, pageBack, pageX, begin, turn, stay, screenW],
  );

  return (
    <BarWindow
      open={open}
      instant={instant}
      onClose={onClose}
      inputRef={inputRef}
      glass="clear"
      // A slight dark tint (tints the glass material, not a solid fill) to give
      // the clear glass some body over bright content.
      tintColor="rgba(0,0,0,0.18)"
      detent={dubzDetent}
      hiddenCollapsed={hiddenCollapsed}
      closeLabel={`Close ${AGENT_NAME}`}
      bodyGesture={paging}
      body={
        // What Dubz suggests: its contents sit at the bottom, on the pill's
        // top, and never move; the window's top only reveals or hides them.
        <View style={styles.suggestionsArea} pointerEvents="box-none">
          <View style={styles.suggestions}>
            {suggestions.map((suggestion) => (
              <Suggestion key={suggestion.kind} suggestion={suggestion} />
            ))}
          </View>
        </View>
      }
      pill={
        <>
          <View style={styles.plusSlot}>
            <PlusChip onPress={open ? noop : onOpen} />
          </View>
          <TextInput
            ref={inputRef}
            style={[styles.input, { maxHeight: open ? LINE_HEIGHT * INPUT_MAX_LINES + INPUT_PAD_V : COMPOSER_SEND_CHIP_SIZE }]}
            value={text}
            onChangeText={setDraft}
            placeholder={`Ask ${AGENT_NAME}…`}
            placeholderTextColor={textColors.placeholderText}
            editable={open}
            multiline
          />
          <SendChip active={text.trim().length > 0} accent="secondary" onPress={open ? () => setDraft("") : onOpen} />
          {/* Collapsed: any tap on the bar opens it. */}
          {open ? null : (
            <Pressable style={StyleSheet.absoluteFill} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Ask ${AGENT_NAME}`} />
          )}
        </>
      }
    />
  );
};

/** One suggestion, by its kind. */
const Suggestion = (props: { readonly suggestion: DubzSuggestion }): React.ReactElement | null => {
  const styles = useThemedStyles(makeStyles);
  switch (props.suggestion.kind) {
    case "tasks":
      // A plain fixed rectangle stands in for the tasks block for now.
      return <View style={styles.placeholder} />;
  }
};

/**
 * The bar where Dubz is the only page (nothing to compose there, as in Files):
 * a Dubz page riding the keyboard where the composer's bar would. Nothing where
 * Dubz is off for the surface.
 */
export const DubzBar = (props: { readonly context: DubzContext }): React.ReactElement | null => {
  const styles = useThemedStyles(makeStyles);
  const visible = useAgentButtonVisible(props.context.surface);
  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef<TextInput>(null);
  const insets = useSafeAreaInsets();
  const slide = useKeyboardSlide(composerRestingBottom(insets.bottom));
  // Dubz is the only page here: nothing to remember.
  const onOpen = React.useCallback(() => setOpen(true), []);
  const onClose = React.useCallback(() => setOpen(false), []);
  if (!visible) return null;
  return (
    <Reanimated.View style={[styles.standalone, slide]} pointerEvents="box-none">
      <DubzPage open={open} instant={false} onOpen={onOpen} onClose={onClose} inputRef={inputRef} context={props.context} />
    </Reanimated.View>
  );
};

/** The input's vertical padding: a single line is the send button's height,
 * so the collapsed pill is the bar's. */
const INPUT_PAD_TOP = Math.ceil((COMPOSER_SEND_CHIP_SIZE - LINE_HEIGHT) / 2);
const INPUT_PAD_BOTTOM = COMPOSER_SEND_CHIP_SIZE - LINE_HEIGHT - INPUT_PAD_TOP;
const INPUT_PAD_V = INPUT_PAD_TOP + INPUT_PAD_BOTTOM;

const makeStyles = (text: TextColors) =>
  StyleSheet.create({
  standalone: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  // The suggestions' space, above the pill: its contents at its bottom.
  suggestionsArea: {
    flex: 1,
    justifyContent: "flex-end",
  },
  // The suggestions themselves: no padding on the area, so it shrinks to
  // nothing collapsed and leaves the pill exactly the bar.
  suggestions: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 16,
  },
  placeholder: {
    height: 106,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  // `+` is smaller than send; bottom-aligned, lift it to send's centre.
  plusSlot: {
    marginBottom: (COMPOSER_SEND_CHIP_SIZE - COMPOSER_CHIP_SIZE) / 2,
  },
  input: {
    flex: 1,
    color: text.label,
    fontSize: 16,
    lineHeight: LINE_HEIGHT,
    paddingTop: INPUT_PAD_TOP,
    paddingBottom: INPUT_PAD_BOTTOM,
    paddingHorizontal: 0,
  },
});
